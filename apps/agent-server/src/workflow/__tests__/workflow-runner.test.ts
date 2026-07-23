import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WorkflowRunner } from "../workflow-runner.js";
import { ToolRegistry } from "../../tools/tool-registry.js";
import { PermissionService } from "../../permissions/permission-service.js";
import { PermissionPolicy } from "../../permissions/permission-policy.js";
import { ApprovalService } from "../../permissions/approval-service.js";
import type { AnyTool } from "../../tools/tool.js";
import type { Agent } from "../../agent/agent.js";
import type { WorkflowDefinition, WorkflowRun } from "@local-agent/contracts";
import { ToolExecutor } from "../../tools/tool-executor.js";
import { defaultAgentConfig } from "../../agent/agent-config.js";

function makePermissionService(): PermissionService {
  const ruleRepository = { listForWorkspace: () => [] } as any;
  const builtinOverrides = { getEnabledOverride: () => null } as any;
  return new PermissionService(new PermissionPolicy(), ruleRepository, builtinOverrides);
}

function makeEchoTool(): AnyTool {
  return {
    name: "echo",
    description: "echoes input",
    inputSchema: z.object({ text: z.string() }),
    risk: "low",
    execute: vi.fn(async (input: { text: string }) => ({ content: `echoed:${input.text}`, summary: "ok" })),
  };
}

/** Fakes the pieces WorkflowRunner touches on RunService/SessionService without a real Fastify/sqlite stack. */
function makeHarness() {
  const runsById = new Map<string, { id: string; sessionId: string; controller: AbortController; events: any[] }>();
  const messages: Array<{ id: string; sessionId: string; role: "user" | "assistant"; content: string; runId: string | null }> = [];

  const runs = {
    create: (sessionId: string) => {
      const run = { id: `run-${runsById.size + 1}`, sessionId, controller: new AbortController(), events: [] as any[] };
      runsById.set(run.id, run);
      return run;
    },
    get: (id: string) => runsById.get(id),
    getActive: (id: string) => runsById.get(id),
    emit: (id: string, event: any) => {
      const run = runsById.get(id);
      run?.events.push(event);
    },
  };

  const sessions = {
    addMessage: (sessionId: string, role: "user" | "assistant", content: string, runId: string | null) => {
      const message = { id: `msg-${messages.length + 1}`, sessionId, role, content, runId };
      messages.push(message);
      return message;
    },
    listMessages: (sessionId: string) => messages.filter((message) => message.sessionId === sessionId),
  };

  return { runs, sessions, runsById, messages };
}

function makeToolExecutor(
  tools: ToolRegistry,
  runs: ReturnType<typeof makeHarness>["runs"],
  permissions = makePermissionService(),
) {
  return new ToolExecutor(tools, permissions, new ApprovalService(), runs as any, defaultAgentConfig);
}

function makeWorkflowStores(workflow: WorkflowDefinition, run: WorkflowRun) {
  const currentRun = { ...run };
  const workflows = { get: (id: string) => (id === workflow.id ? workflow : null) };
  const workflowRuns = {
    get: (id: string) => (id === currentRun.id ? { ...currentRun } : null),
    update: (id: string, changes: Partial<WorkflowRun>) => {
      if (id !== currentRun.id) return null;
      Object.assign(currentRun, changes);
      return { ...currentRun };
    },
  };
  return { workflows, workflowRuns, getCurrentRun: () => currentRun };
}

describe("WorkflowRunner", () => {
  it("runs a skill node, capturing the agent's final message as the step output variable", async () => {
    const harness = makeHarness();
    const agent = {
      run: vi.fn(async (runId: string, sessionId: string) => {
        harness.sessions.addMessage(sessionId, "assistant", "design doc content", runId);
        harness.runs.emit(runId, { type: "run.completed" });
      }),
    } as unknown as Agent;

    const workflow: WorkflowDefinition = {
      id: "wf-1",
      workspaceId: "workspace-1",
      name: "Test",
      description: "",
      version: "1.0.0",
      nodes: [{ id: "n1", type: "skill", label: "PRD to Design", skillId: "prd-to-design", outputVariable: "design_doc" }],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-1",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns, getCurrentRun } = makeWorkflowStores(workflow, run);

    const tools = new ToolRegistry();
    const runner = new WorkflowRunner({
      agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await runner.run(run.id, "workspace-1", {});

    expect(agent.run).toHaveBeenCalledWith(expect.any(String), "session-1", "workspace-1", expect.any(String), "prd-to-design");
    const finalState = getCurrentRun();
    expect(finalState.status).toBe("completed");
    expect(finalState.variables.design_doc).toBe("design doc content");
    expect(finalState.nodeStates.n1?.status).toBe("succeeded");
  });

  it("runs a tool node directly and passes its output to the next step via variables", async () => {
    const harness = makeHarness();
    const tools = new ToolRegistry();
    const echoTool = makeEchoTool();
    tools.register(echoTool);

    const workflow: WorkflowDefinition = {
      id: "wf-2",
      workspaceId: "workspace-1",
      name: "Test",
      description: "",
      version: "1.0.0",
      nodes: [{ id: "n1", type: "tool", label: "Echo", toolName: "echo", argsTemplate: { text: "{{input}}" }, outputVariable: "echoed" }],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-2",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns, getCurrentRun } = makeWorkflowStores(workflow, run);

    const runner = new WorkflowRunner({
      agent: { run: vi.fn() } as unknown as Agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await runner.run(run.id, "workspace-1", { input: "hello" });

    expect(echoTool.execute).toHaveBeenCalledWith({ text: "hello" }, expect.objectContaining({ workspaceRoot: "/workspace" }));
    const finalState = getCurrentRun();
    expect(finalState.status).toBe("completed");
    expect(finalState.variables.echoed).toBe("echoed:hello");
  });

  it("marks the run failed and records the error when a node throws", async () => {
    const harness = makeHarness();
    const workflow: WorkflowDefinition = {
      id: "wf-3",
      workspaceId: "workspace-1",
      name: "Test",
      description: "",
      version: "1.0.0",
      nodes: [{ id: "n1", type: "tool", label: "Missing tool", toolName: "does_not_exist", argsTemplate: {}, outputVariable: "out" }],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-3",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns, getCurrentRun } = makeWorkflowStores(workflow, run);

    const tools = new ToolRegistry();
    const runner = new WorkflowRunner({
      agent: { run: vi.fn() } as unknown as Agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await runner.run(run.id, "workspace-1", {});

    const finalState = getCurrentRun();
    expect(finalState.status).toBe("failed");
    expect(finalState.errorMessage).toContain("Unknown tool");
    expect(finalState.nodeStates.n1?.status).toBe("failed");
  });

  it("denies a tool node call that matches a deny permission rule, failing the run", async () => {
    const harness = makeHarness();
    const tools = new ToolRegistry();
    const writeTool: AnyTool = {
      name: "write_file",
      description: "",
      inputSchema: z.object({ path: z.string() }),
      risk: "medium",
      execute: vi.fn(async () => ({ content: "", summary: "" })),
    };
    tools.register(writeTool);

    const denyRule = {
      id: "deny-env",
      workspaceId: "workspace-1",
      toolName: "write_file",
      matcher: { kind: "path" as const, pattern: "**/.env*" },
      decision: "deny" as const,
      priority: 100,
      enabled: true,
      source: "custom" as const,
      createdAt: "",
    };
    const permissions = new PermissionService(
      new PermissionPolicy(),
      { listForWorkspace: () => [denyRule] } as any,
      { getEnabledOverride: () => null } as any,
    );

    const workflow: WorkflowDefinition = {
      id: "wf-4",
      workspaceId: "workspace-1",
      name: "Test",
      description: "",
      version: "1.0.0",
      nodes: [{ id: "n1", type: "tool", label: "Write env", toolName: "write_file", argsTemplate: { path: ".env" }, outputVariable: "out" }],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-4",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns, getCurrentRun } = makeWorkflowStores(workflow, run);

    const runner = new WorkflowRunner({
      agent: { run: vi.fn() } as unknown as Agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs, permissions),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await runner.run(run.id, "workspace-1", {});

    expect(writeTool.execute).not.toHaveBeenCalled();
    expect(getCurrentRun().status).toBe("failed");
  });

  it("pauses at a user_input node, posting the question as an assistant message and marking the run waiting-input", async () => {
    const harness = makeHarness();
    const workflow: WorkflowDefinition = {
      id: "wf-5",
      workspaceId: "workspace-1",
      name: "Skill Evaluation",
      description: "",
      version: "1.0.0",
      nodes: [
        { id: "n1", type: "user_input", label: "Ask which skill", question: "Which skill would you like to evaluate?", outputVariable: "target_skill_name" },
        { id: "n2", type: "skill", label: "Run target skill", skillId: "{{target_skill_name}}", outputVariable: "live_result" },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-5",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns, getCurrentRun } = makeWorkflowStores(workflow, run);

    const tools = new ToolRegistry();
    const runner = new WorkflowRunner({
      agent: { run: vi.fn() } as unknown as Agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await runner.run(run.id, "workspace-1", {});

    const paused = getCurrentRun();
    expect(paused.status).toBe("waiting-input");
    expect(paused.currentNodeId).toBe("n1");
    expect(harness.messages).toContainEqual(expect.objectContaining({ role: "assistant", content: "Which skill would you like to evaluate?" }));
  });

  it("resumes a paused run, feeding the chat reply into the output variable and dynamically resolving a templated skillId", async () => {
    const harness = makeHarness();
    const agent = {
      run: vi.fn(async (runId: string, sessionId: string) => {
        harness.sessions.addMessage(sessionId, "assistant", "code-review looks solid", runId);
        harness.runs.emit(runId, { type: "run.completed" });
      }),
    } as unknown as Agent;

    const workflow: WorkflowDefinition = {
      id: "wf-6",
      workspaceId: "workspace-1",
      name: "Skill Evaluation",
      description: "",
      version: "1.0.0",
      nodes: [
        { id: "n1", type: "user_input", label: "Ask which skill", question: "Which skill would you like to evaluate?", outputVariable: "target_skill_name" },
        { id: "n2", type: "skill", label: "Run target skill", skillId: "{{target_skill_name}}", outputVariable: "live_result" },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-6",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns, getCurrentRun } = makeWorkflowStores(workflow, run);

    const tools = new ToolRegistry();
    const runner = new WorkflowRunner({
      agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await runner.run(run.id, "workspace-1", {});
    await runner.resume(run.id, "workspace-1", "code-review");

    expect(agent.run).toHaveBeenCalledWith(expect.any(String), "session-1", "workspace-1", expect.any(String), "code-review");
    const finalState = getCurrentRun();
    expect(finalState.status).toBe("completed");
    expect(finalState.variables.target_skill_name).toBe("code-review");
    expect(finalState.variables.live_result).toBe("code-review looks solid");
    expect(finalState.nodeStates.n1?.status).toBe("succeeded");
    expect(finalState.nodeStates.n2?.status).toBe("succeeded");
  });

  it("rejects resuming a run that is not currently waiting for input", async () => {
    const harness = makeHarness();
    const workflow: WorkflowDefinition = {
      id: "wf-7",
      workspaceId: "workspace-1",
      name: "Test",
      description: "",
      version: "1.0.0",
      nodes: [],
      createdAt: "",
      updatedAt: "",
    };
    const run: WorkflowRun = {
      id: "wfrun-7",
      workflowId: workflow.id,
      sessionId: "session-1",
      status: "completed",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: "",
    };
    const { workflows, workflowRuns } = makeWorkflowStores(workflow, run);

    const tools = new ToolRegistry();
    const runner = new WorkflowRunner({
      agent: { run: vi.fn() } as unknown as Agent,
      workspaceRoot: "/workspace",
      tools,
      toolExecutor: makeToolExecutor(tools, harness.runs),
      runs: harness.runs as any,
      sessions: harness.sessions as any,
      workflows: workflows as any,
      workflowRuns: workflowRuns as any,
    });

    await expect(runner.resume(run.id, "workspace-1", "anything")).rejects.toThrow("not waiting for input");
  });
});
