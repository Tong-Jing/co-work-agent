import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApprovalService } from "../../permissions/approval-service.js";
import { ToolRegistry } from "../tool-registry.js";
import { ToolExecutor } from "../tool-executor.js";

function setup(execute: () => Promise<{ content: string; summary: string }>, options: { idempotent?: boolean; threshold?: number; requiresApproval?: boolean } = {}) {
  const tools = new ToolRegistry();
  tools.register({
    name: "test_tool",
    description: "test",
    inputSchema: z.object({ value: z.string() }),
    risk: "low",
    ...(options.idempotent === undefined ? {} : { idempotent: options.idempotent }),
    execute: vi.fn(execute),
  });
  const events: unknown[] = [];
  const runs = { emit: vi.fn((_runId: string, event: unknown) => events.push(event)) };
  const permissions = { evaluate: () => ({ decision: "allow", requiresApproval: options.requiresApproval ?? false, matchedRuleId: null }), displayRisk: () => "medium" };
  const approvals = new ApprovalService();
  const executor = new ToolExecutor(tools, permissions as any, approvals, runs as any, {
    toolTimeoutMs: 20,
    approvalTimeoutMs: 20,
    maxRetries: 2,
    maxToolResultTokens: 100,
    circuitBreakerFailureThreshold: options.threshold ?? 3,
    circuitBreakerCooldownMs: 10_000,
  });
  const request = {
    runId: "run-1",
    callId: "call-1",
    toolName: "test_tool",
    rawInput: { value: "x" },
    serializedInput: "{\"value\":\"x\"}",
    workspaceId: "workspace-1",
    workspaceRoot: "/workspace",
    signal: new AbortController().signal,
  };
  return { executor, request, tools, events, approvals };
}

describe("ToolExecutor", () => {
  it("validates, executes, bounds output, and emits lifecycle events", async () => {
    const { executor, request, events } = setup(async () => ({ content: "x".repeat(1_000), summary: "done" }));
    const outcome = await executor.execute(request);
    expect(outcome).toEqual(expect.objectContaining({ status: "succeeded", attempts: 1 }));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool.requested" }), expect.objectContaining({ type: "tool.completed" })]));
    expect(outcome.content.length).toBeLessThan(1_000);
  });

  it("retries transient failures only for idempotent tools", async () => {
    let calls = 0;
    const transient = async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return { content: "ok", summary: "ok" };
    };
    const { executor, request } = setup(transient, { idempotent: true });
    expect(await executor.execute(request)).toEqual(expect.objectContaining({ status: "succeeded", attempts: 3 }));

    calls = 0;
    const nonIdempotent = setup(transient);
    expect(await nonIdempotent.executor.execute(nonIdempotent.request)).toEqual(expect.objectContaining({ status: "failed", attempts: 1 }));
  });

  it("times out an uncooperative tool and opens its circuit after repeated failures", async () => {
    const { executor, request, tools } = setup(() => new Promise(() => {}), { threshold: 2 });
    expect(await executor.execute(request)).toEqual(expect.objectContaining({ status: "failed", kind: "timeout" }));
    expect(await executor.execute({ ...request, callId: "call-2" })).toEqual(expect.objectContaining({ status: "failed", kind: "timeout" }));
    expect(await executor.execute({ ...request, callId: "call-3" })).toEqual(expect.objectContaining({ status: "failed", kind: "circuit-open", attempts: 0 }));
    expect(tools.get("test_tool")?.execute).toHaveBeenCalledTimes(2);
  });

  it("times out approval without executing the tool and clears the pending decision", async () => {
    const { executor, request, tools, approvals } = setup(async () => ({ content: "ok", summary: "ok" }), { requiresApproval: true });
    expect(await executor.execute(request)).toEqual(expect.objectContaining({ status: "failed", kind: "timeout", attempts: 0 }));
    expect(tools.get("test_tool")?.execute).not.toHaveBeenCalled();
    expect(approvals.decide(request.callId, "allow")).toBe(false);
  });
});