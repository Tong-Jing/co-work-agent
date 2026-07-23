import type { ApprovalService } from "../permissions/approval-service.js";
import type { PermissionService } from "../permissions/permission-service.js";
import type { RunService } from "../sessions/run-service.js";
import { truncateToolResult } from "../agent/context-budget.js";
import type { ToolRegistry } from "./tool-registry.js";

export type ToolFailureKind = "validation" | "permission" | "timeout" | "transient" | "permanent" | "circuit-open";

export type ToolExecutionOutcome =
  | { status: "succeeded"; content: string; summary: string; attempts: number }
  | { status: "denied"; content: string; summary: string; attempts: 0 }
  | { status: "failed"; content: string; summary: string; error: string; kind: ToolFailureKind; attempts: number };

export interface ToolExecutorOptions {
  toolTimeoutMs: number;
  approvalTimeoutMs: number;
  maxRetries: number;
  maxToolResultTokens: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerCooldownMs: number;
}

interface ExecuteToolRequest {
  runId: string;
  callId: string;
  toolName: string;
  rawInput?: unknown;
  serializedInput: string;
  workspaceId: string;
  workspaceRoot: string;
  signal: AbortSignal;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

export class ToolExecutor {
  readonly #circuits = new Map<string, CircuitState>();

  constructor(
    private readonly tools: ToolRegistry,
    private readonly permissions: PermissionService,
    private readonly approvals: ApprovalService,
    private readonly runs: RunService,
    private readonly options: ToolExecutorOptions,
  ) {}

  async execute(request: ExecuteToolRequest): Promise<ToolExecutionOutcome> {
    const tool = this.tools.get(request.toolName);
    if (!tool) return this.failed(request, request.toolName, "validation", `Unknown tool: ${request.toolName}`, 0);

    this.runs.emit(request.runId, {
      type: "tool.requested",
      callId: request.callId,
      tool: tool.name,
      source: tool.source ?? "local",
      ...(tool.mcpServer ? { mcpServer: tool.mcpServer } : {}),
      arguments: request.serializedInput,
      summary: `Calling ${tool.name}`,
    });

    let input: unknown;
    try {
      const rawInput = request.rawInput === undefined ? JSON.parse(request.serializedInput) : request.rawInput;
      input = tool.inputSchema.parse(rawInput);
    } catch (error) {
      return this.failed(request, tool.name, "validation", errorMessage(error), 0);
    }

    let evaluation: ReturnType<PermissionService["evaluate"]>;
    try {
      evaluation = this.permissions.evaluate(tool, input, request.workspaceId);
    } catch (error) {
      return this.failed(request, tool.name, "permission", errorMessage(error), 0);
    }
    if (evaluation.decision === "deny") {
      const reason = `Denied by permission rule${evaluation.matchedRuleId ? ` (${evaluation.matchedRuleId})` : ""}: ${tool.name}`;
      this.runs.emit(request.runId, {
        type: "tool.denied",
        callId: request.callId,
        tool: tool.name,
        reason,
        matchedRuleId: evaluation.matchedRuleId,
      });
      return { status: "denied", content: reason, summary: reason, attempts: 0 };
    }

    if (evaluation.requiresApproval) {
      this.runs.emit(request.runId, {
        type: "approval.required",
        callId: request.callId,
        tool: tool.name,
        summary: `${tool.name}: ${JSON.stringify(input).slice(0, 1000)}`,
        risk: this.permissions.displayRisk(tool.risk),
        matchedRuleId: evaluation.matchedRuleId,
      });
      try {
        const decision = await withTimeout(
          (signal) => this.approvals.wait(request.callId, request.runId, signal),
          request.signal,
          this.options.approvalTimeoutMs,
          `Approval timed out after ${this.options.approvalTimeoutMs}ms`,
        );
        if (decision === "deny") {
          const reason = `User denied tool execution: ${tool.name}`;
          return { status: "denied", content: reason, summary: reason, attempts: 0 };
        }
      } catch (error) {
        if (request.signal.aborted) throw request.signal.reason ?? error;
        return this.failed(request, tool.name, "timeout", errorMessage(error), 0);
      }
    }

    const circuitKey = tool.source === "mcp" ? `${tool.mcpServer ?? "mcp"}:${tool.name}` : tool.name;
    if (this.isCircuitOpen(circuitKey)) {
      return this.failed(request, tool.name, "circuit-open", `Circuit breaker is open for ${tool.name}`, 0);
    }

    const maxAttempts = tool.idempotent ? this.options.maxRetries + 1 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await withTimeout(
          (signal) => tool.execute(input, { workspaceRoot: request.workspaceRoot, signal }),
          request.signal,
          this.options.toolTimeoutMs,
          `Tool ${tool.name} timed out after ${this.options.toolTimeoutMs}ms`,
        );
        this.#circuits.delete(circuitKey);
        const content = truncateToolResult(result.content, this.options.maxToolResultTokens);
        this.runs.emit(request.runId, {
          type: "tool.completed",
          callId: request.callId,
          tool: tool.name,
          result: content,
          summary: result.summary,
        });
        return { status: "succeeded", content, summary: result.summary, attempts: attempt };
      } catch (error) {
        if (request.signal.aborted) throw request.signal.reason ?? error;
        const kind = classifyError(error);
        if (attempt < maxAttempts && (kind === "timeout" || kind === "transient")) {
          await abortableDelay(50 * 2 ** (attempt - 1), request.signal);
          continue;
        }
        if (kind === "timeout" || kind === "transient") this.recordFailure(circuitKey);
        return this.failed(request, tool.name, kind, errorMessage(error), attempt);
      }
    }

    return this.failed(request, tool.name, "permanent", `Tool ${tool.name} failed`, maxAttempts);
  }

  private failed(request: ExecuteToolRequest, toolName: string, kind: ToolFailureKind, message: string, attempts: number): ToolExecutionOutcome {
    const summary = `Tool ${toolName} failed (${kind}): ${message}`;
    this.runs.emit(request.runId, {
      type: "tool.failed",
      callId: request.callId,
      tool: toolName,
      error: message,
      summary,
    });
    return { status: "failed", content: summary, summary, error: message, kind, attempts };
  }

  private isCircuitOpen(key: string) {
    const state = this.#circuits.get(key);
    if (!state?.openedAt) return false;
    if (Date.now() - state.openedAt >= this.options.circuitBreakerCooldownMs) {
      this.#circuits.delete(key);
      return false;
    }
    return true;
  }

  private recordFailure(key: string) {
    const current = this.#circuits.get(key) ?? { failures: 0, openedAt: null };
    const failures = current.failures + 1;
    this.#circuits.set(key, {
      failures,
      openedAt: failures >= this.options.circuitBreakerFailureThreshold ? Date.now() : null,
    });
  }
}

class OperationTimeoutError extends Error {
  override name = "OperationTimeoutError";
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, parentSignal: AbortSignal, timeoutMs: number, message: string): Promise<T> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(new OperationTimeoutError(message)), timeoutMs);
  const signal = AbortSignal.any([parentSignal, timeoutController.signal]);
  try {
    return await Promise.race([
      operation(signal),
      new Promise<T>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function classifyError(error: unknown): ToolFailureKind {
  if (error instanceof OperationTimeoutError) return "timeout";
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "SQLITE_BUSY"].includes(code) || status === 408 || status === 429 || status >= 500) {
    return "transient";
  }
  return "permanent";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown tool error";
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}