import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReactLoop } from "../react-loop.js";
import { ToolRegistry } from "../../tools/tool-registry.js";
import { PermissionService } from "../../permissions/permission-service.js";
import { PermissionPolicy } from "../../permissions/permission-policy.js";
import { ApprovalService } from "../../permissions/approval-service.js";
import type { PermissionRule } from "../../permissions/permission-rule.js";
import type { AnyTool } from "../../tools/tool.js";
import type { LlmProvider } from "../../llm/llm-provider.js";
import type { LlmResponse } from "../../llm/llm-types.js";
import { defaultAgentConfig } from "../agent-config.js";
import { ToolExecutor } from "../../tools/tool-executor.js";

function makeRun(runId: string) {
  const events: unknown[] = [];
  return {
    id: runId,
    sessionId: "session-1",
    controller: new AbortController(),
    events,
    emit: vi.fn((event: unknown) => events.push(event)),
  };
}

function makeRunsFake(run: ReturnType<typeof makeRun>) {
  return {
    get: (id: string) => (id === run.id ? run : undefined),
    getActive: (id: string) => (id === run.id ? run : undefined),
    emit: run.emit,
    saveCheckpoint: vi.fn(() => true),
  };
}

function makeEchoTool(overrides: Partial<AnyTool> = {}): AnyTool {
  return {
    name: "echo",
    description: "echoes input",
    inputSchema: z.object({ text: z.string() }),
    risk: "low",
    execute: vi.fn(async (input: { text: string }) => ({ content: input.text, summary: `echoed ${input.text}` })),
    ...overrides,
  };
}

function makePermissionService(rules: PermissionRule[] = []): PermissionService {
  const ruleRepository = { listForWorkspace: () => rules } as any;
  const builtinOverrides = { getEnabledOverride: () => null } as any;
  return new PermissionService(new PermissionPolicy(), ruleRepository, builtinOverrides);
}

function buildLoop(options: {
  llm: LlmProvider;
  tool?: AnyTool;
  permissions?: PermissionService;
  approvals?: ApprovalService;
}) {
  const tools = new ToolRegistry();
  const tool = options.tool ?? makeEchoTool();
  tools.register(tool);

  const run = makeRun("run-1");
  const runs = makeRunsFake(run);
  const sessions = { addMessage: vi.fn() };
  const autoMemories = { add: vi.fn() };
  const permissions = options.permissions ?? makePermissionService();
  const approvals = options.approvals ?? new ApprovalService();
  const toolExecutor = new ToolExecutor(tools, permissions, approvals, runs as any, defaultAgentConfig);

  const loop = new ReactLoop({
    llm: options.llm,
    tools,
    toolExecutor,
    runs: runs as any,
    sessions: sessions as any,
    autoMemories: autoMemories as any,
    workspaceRoot: "/workspace",
  });

  return { loop, run, sessions, autoMemories, tool };
}

describe("ReactLoop", () => {
  it("completes immediately when the LLM returns no tool calls", async () => {
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => ({ id: "r1", content: "final answer", toolCalls: [] })),
    };
    const { loop, run, sessions, autoMemories } = buildLoop({ llm });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "hi" }]);

    expect(sessions.addMessage).toHaveBeenCalledWith(run.sessionId, "assistant", "final answer", run.id);
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.completed" }));
    // no successful tool observations => no auto memory captured
    expect(autoMemories.add).not.toHaveBeenCalled();
  });

  it("fails a run that exceeds its total timeout even when the provider ignores abort", async () => {
    const llm: LlmProvider = { complete: vi.fn(() => new Promise<LlmResponse>(() => {})) };
    const { loop, run } = buildLoop({ llm });

    await loop.run({ ...defaultAgentConfig, runTimeoutMs: 20 }, run.id, "workspace-1", [{ role: "user", content: "wait" }]);

    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.failed", message: expect.stringContaining("timed out") }));
  });

  it("preserves user cancellation semantics instead of reporting a timeout", async () => {
    const llm: LlmProvider = { complete: vi.fn(() => new Promise<LlmResponse>(() => {})) };
    const { loop, run } = buildLoop({ llm });
    const promise = loop.run({ ...defaultAgentConfig, runTimeoutMs: 1_000 }, run.id, "workspace-1", [{ role: "user", content: "wait" }]);
    run.controller.abort(new Error("Cancelled by user"));

    await promise;

    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.cancelled" }));
    expect(run.emit).not.toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.failed" }));
  });

  it("executes a low-risk tool without approval and feeds the result back to the LLM", async () => {
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => {
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "echo", arguments: JSON.stringify({ text: "hello" }) }],
          };
        }
        return { id: "r2", content: "done", toolCalls: [] };
      }),
    };
    const { loop, run, tool, autoMemories } = buildLoop({ llm });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "run echo" }]);

    expect(tool.execute).toHaveBeenCalledWith({ text: "hello" }, expect.objectContaining({ workspaceRoot: "/workspace" }));
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "tool.completed", tool: "echo" }));
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.completed" }));
    // successful tool observation => auto memory should be captured
    expect(autoMemories.add).toHaveBeenCalledTimes(1);
  });

  it("keeps the run completed when automatic memory capture fails", async () => {
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => {
        call += 1;
        return call === 1
          ? { id: "r1", content: null, toolCalls: [{ id: "call-1", name: "echo", arguments: JSON.stringify({ text: "hello" }) }] }
          : { id: "r2", content: "done", toolCalls: [] };
      }),
    };
    const { loop, run, autoMemories } = buildLoop({ llm });
    autoMemories.add.mockRejectedValueOnce(new Error("memory database unavailable"));

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "run echo" }]);

    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.completed" }));
    expect(run.emit).not.toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.failed" }));
  });

  it.each([
    {
      name: "malformed JSON arguments",
      arguments: "{not-json",
      tool: makeEchoTool(),
      expectedError: "JSON",
    },
    {
      name: "arguments that fail schema validation",
      arguments: JSON.stringify({ text: 42 }),
      tool: makeEchoTool(),
      expectedError: "string",
    },
    {
      name: "an exception thrown by the tool",
      arguments: JSON.stringify({ text: "missing/path" }),
      tool: makeEchoTool({
        execute: vi.fn(async () => {
          throw new Error("ENOENT: no such file or directory");
        }),
      }),
      expectedError: "ENOENT",
    },
  ])("recovers from $name and feeds the failure back to the LLM", async ({ arguments: toolArguments, tool, expectedError }) => {
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (request): Promise<LlmResponse> => {
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "echo", arguments: toolArguments }],
          };
        }
        expect(request.messages.at(-1)).toEqual(expect.objectContaining({
          role: "tool",
          toolCallId: "call-1",
          content: expect.stringContaining(expectedError),
        }));
        return { id: "r2", content: "recovered", toolCalls: [] };
      }),
    };
    const { loop, run, sessions } = buildLoop({ llm, tool });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "try the tool" }]);

    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({
      type: "tool.failed",
      tool: "echo",
      error: expect.stringContaining(expectedError),
    }));
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.completed" }));
    expect(run.emit).not.toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.failed" }));
    expect(sessions.addMessage).toHaveBeenCalledWith(run.sessionId, "assistant", "recovered", run.id);
  });

  it("requires approval for a risky tool and skips execution when denied", async () => {
    const riskyTool = makeEchoTool({ risk: "high" });
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => {
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "echo", arguments: JSON.stringify({ text: "hello" }) }],
          };
        }
        return { id: "r2", content: "acknowledged denial", toolCalls: [] };
      }),
    };

    const approvals = new ApprovalService();
    const { loop, run } = buildLoop({ llm, tool: riskyTool, approvals });

    const runPromise = loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "run echo" }]);

    // wait a tick for approval.required to be requested, then deny it
    await vi.waitFor(() => expect(approvals.decide("call-1", "deny")).toBe(true));

    await runPromise;

    expect(riskyTool.execute).not.toHaveBeenCalled();
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "approval.required", tool: "echo" }));
  });

  it("fails the run when the iteration limit is reached without a final answer", async () => {
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => ({
        id: "r",
        content: null,
        toolCalls: [{ id: "call-x", name: "echo", arguments: JSON.stringify({ text: "loop" }) }],
      })),
    };
    const { loop, run } = buildLoop({ llm });

    await loop.run({ ...defaultAgentConfig, maxIterations: 2 }, run.id, "workspace-1", [{ role: "user", content: "loop" }]);

    expect(run.emit).toHaveBeenCalledWith(
      run.id,
      expect.objectContaining({ type: "run.failed", message: expect.stringContaining("2-iteration limit") }),
    );
  });

  it("rejects a tool call outside the allowedTools list, without executing it", async () => {
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => {
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "echo", arguments: JSON.stringify({ text: "hello" }) }],
          };
        }
        return { id: "r2", content: "acknowledged", toolCalls: [] };
      }),
    };
    const { loop, run, tool } = buildLoop({ llm });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "run echo" }], ["some_other_tool"]);

    expect(tool.execute).not.toHaveBeenCalled();
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "run.completed" }));
  });

  it("keeps the full conversation history across tool-call rounds instead of discarding it", async () => {
    let call = 0;
    const seenMessageCounts: number[] = [];
    const llm: LlmProvider = {
      complete: vi.fn(async (request): Promise<LlmResponse> => {
        seenMessageCounts.push(request.messages.length);
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "echo", arguments: JSON.stringify({ text: "hello" }) }],
          };
        }
        if (call === 2) {
          return {
            id: "r2",
            content: null,
            toolCalls: [{ id: "call-2", name: "echo", arguments: JSON.stringify({ text: "world" }) }],
          };
        }
        return { id: "r3", content: "done", toolCalls: [] };
      }),
    };
    const { loop, run } = buildLoop({ llm });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [
      { role: "system", content: "system prompt" },
      { role: "user", content: "run echo twice" },
    ]);

    // round 1: system + user = 2
    // round 2: +assistant tool-call + tool result = 4
    // round 3: +assistant tool-call + tool result = 6
    expect(seenMessageCounts).toEqual([2, 4, 6]);
  });

  it("passes the allowedTools list through to tool definitions sent to the LLM", async () => {
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => ({ id: "r1", content: "done", toolCalls: [] })),
    };
    const { loop, run } = buildLoop({ llm });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "hi" }], ["echo"]);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [expect.objectContaining({ function: expect.objectContaining({ name: "echo" }) })] }),
    );
  });

  it("denies a tool call matching a deny rule without prompting for approval", async () => {
    const writeTool = makeEchoTool({ name: "write_file", risk: "medium" });
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => {
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "write_file", arguments: JSON.stringify({ text: ".env" }) }],
          };
        }
        return { id: "r2", content: "acknowledged", toolCalls: [] };
      }),
    };
    const denyRule: PermissionRule = {
      id: "deny-rule",
      workspaceId: "workspace-1",
      toolName: "write_file",
      matcher: { kind: "arg", field: "text", values: [".env"] },
      decision: "deny",
      priority: 100,
      enabled: true,
      source: "custom",
      createdAt: new Date().toISOString(),
    };
    const permissions = makePermissionService([denyRule]);
    const approvals = new ApprovalService();
    const waitSpy = vi.spyOn(approvals, "wait");
    const { loop, run } = buildLoop({ llm, tool: writeTool, permissions, approvals });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "write .env" }]);

    expect(writeTool.execute).not.toHaveBeenCalled();
    expect(waitSpy).not.toHaveBeenCalled();
    expect(run.emit).toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "tool.denied", tool: "write_file", matchedRuleId: "deny-rule" }));
  });

  it("skips approval entirely when an allow rule matches", async () => {
    const writeTool = makeEchoTool({ name: "write_file", risk: "medium" });
    let call = 0;
    const llm: LlmProvider = {
      complete: vi.fn(async (): Promise<LlmResponse> => {
        call += 1;
        if (call === 1) {
          return {
            id: "r1",
            content: null,
            toolCalls: [{ id: "call-1", name: "write_file", arguments: JSON.stringify({ text: "tmp/scratch.txt" }) }],
          };
        }
        return { id: "r2", content: "done", toolCalls: [] };
      }),
    };
    const allowRule: PermissionRule = {
      id: "allow-rule",
      workspaceId: "workspace-1",
      toolName: "write_file",
      matcher: { kind: "arg", field: "text", values: ["tmp/scratch.txt"] },
      decision: "allow",
      priority: 10,
      enabled: true,
      source: "custom",
      createdAt: new Date().toISOString(),
    };
    const permissions = makePermissionService([allowRule]);
    const { loop, run } = buildLoop({ llm, tool: writeTool, permissions });

    await loop.run(defaultAgentConfig, run.id, "workspace-1", [{ role: "user", content: "write tmp file" }]);

    expect(writeTool.execute).toHaveBeenCalled();
    expect(run.emit).not.toHaveBeenCalledWith(run.id, expect.objectContaining({ type: "approval.required" }));
  });
});
