import type { Agent } from "../agent/agent.js";
import type { RunService } from "../sessions/run-service.js";
import type { SessionService } from "../sessions/session-service.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { WorkflowRunRepository } from "./workflow-run-repository.js";
import type { WorkflowRepository } from "./workflow-repository.js";
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeState, WorkflowRun } from "@local-agent/contracts";
import { coerceTemplateValue, renderTemplate } from "./template.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { ToolExecutor } from "../tools/tool-executor.js";

interface WorkflowRunnerDependencies {
  agent: Agent;
  workspaces?: WorkspaceService;
  workspaceRoot?: string;
  tools: ToolRegistry;
  toolExecutor: ToolExecutor;
  runs: RunService;
  sessions: SessionService;
  workflows: WorkflowRepository;
  workflowRuns: WorkflowRunRepository;
}

export class WorkflowRunner {
  constructor(private readonly dependencies: WorkflowRunnerDependencies) {}

  async run(workflowRunId: string, workspaceId: string, initialVariables: Record<string, string>) {
    const run = this.dependencies.workflowRuns.get(workflowRunId);
    if (!run) throw new Error("Workflow run not found");
    const workflow = this.dependencies.workflows.get(run.workflowId);
    if (!workflow) throw new Error("Workflow definition not found");

    await this.execute(workflow, run, 0, { ...initialVariables }, {});
  }

  /** Continues a run that paused at a `user_input` node, feeding the user's chat reply in as that node's output variable. */
  async resume(workflowRunId: string, workspaceId: string, answer: string) {
    const run = this.dependencies.workflowRuns.get(workflowRunId);
    if (!run) throw new Error("Workflow run not found");
    if (run.status !== "waiting-input" || !run.currentNodeId) throw new Error("Workflow run is not waiting for input");
    const workflow = this.dependencies.workflows.get(run.workflowId);
    if (!workflow) throw new Error("Workflow definition not found");

    const pausedIndex = workflow.nodes.findIndex((node) => node.id === run.currentNodeId);
    if (pausedIndex === -1) throw new Error("Paused node no longer exists in the workflow definition");
    const pausedNode = workflow.nodes[pausedIndex]!;

    const nodeStates = { ...run.nodeStates };
    nodeStates[pausedNode.id] = {
      status: "succeeded",
      output: answer,
      startedAt: nodeStates[pausedNode.id]?.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    const variables = { ...run.variables, [pausedNode.outputVariable]: answer };
    this.dependencies.sessions.addMessage(run.sessionId, "user", answer, null);

    await this.execute(workflow, { ...run, nodeStates, variables }, pausedIndex + 1, variables, nodeStates);
  }

  private async execute(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    startIndex: number,
    initialVariables: Record<string, string>,
    initialNodeStates: Record<string, WorkflowNodeState>,
  ) {
    let variables = initialVariables;
    const nodeStates: Record<string, WorkflowNodeState> = { ...initialNodeStates };

    try {
      for (let index = startIndex; index < workflow.nodes.length; index++) {
        const node = workflow.nodes[index]!;

        if (node.type === "user_input") {
          nodeStates[node.id] = { status: "running", output: null, startedAt: new Date().toISOString(), finishedAt: null };
          this.dependencies.sessions.addMessage(run.sessionId, "assistant", node.question, null);
          this.emitRoot(run, { type: "workflow.node.waiting-input", workflowRunId: run.id, nodeId: node.id, label: node.label });
          this.persist(run.id, { status: "waiting-input", currentNodeId: node.id, nodeStates, variables });
          return;
        }

        nodeStates[node.id] = { status: "running", output: null, startedAt: new Date().toISOString(), finishedAt: null };
        this.emitRoot(run, { type: "workflow.node.started", workflowRunId: run.id, nodeId: node.id, label: node.label });
        this.persist(run.id, { status: "running", currentNodeId: node.id, nodeStates, variables });

        const output = await this.runNode(node, run, workflow.workspaceId, variables);

        nodeStates[node.id] = { status: "succeeded", output, startedAt: nodeStates[node.id]!.startedAt, finishedAt: new Date().toISOString() };
        this.emitRoot(run, { type: "workflow.node.completed", workflowRunId: run.id, nodeId: node.id, label: node.label });
        variables = { ...variables, [node.outputVariable]: output ?? "" };
        this.persist(run.id, { status: "running", currentNodeId: node.id, nodeStates, variables });
      }

      this.persist(run.id, { status: "completed", currentNodeId: null, nodeStates, variables });
      if (run.rootRunId) this.dependencies.runs.emit(run.rootRunId, { type: "run.completed" });
    } catch (error) {
      const currentNodeId = this.dependencies.workflowRuns.get(run.id)?.currentNodeId ?? null;
      if (currentNodeId && nodeStates[currentNodeId]) {
        nodeStates[currentNodeId] = { ...nodeStates[currentNodeId]!, status: "failed", finishedAt: new Date().toISOString() };
      }
      const message = error instanceof Error ? error.message : "Unknown workflow error";
      const root = run.rootRunId ? this.dependencies.runs.getActive(run.rootRunId) : undefined;
      const cancelled = root?.controller.signal.aborted ?? false;
      console.error(`[workflow-runner] run failed workflowRunId=${run.id}`, error);
      this.persist(run.id, { status: cancelled ? "cancelled" : "failed", currentNodeId, nodeStates, variables, errorMessage: message });
      if (currentNodeId) {
        const node = workflow.nodes.find((candidate) => candidate.id === currentNodeId);
        if (node) this.emitRoot(run, { type: "workflow.node.failed", workflowRunId: run.id, nodeId: node.id, label: node.label, message });
      }
      if (run.rootRunId) this.dependencies.runs.emit(run.rootRunId, cancelled ? { type: "run.cancelled" } : { type: "run.failed", message });
    }
  }

  private persist(workflowRunId: string, changes: Partial<Pick<WorkflowRun, "status" | "currentNodeId" | "nodeStates" | "variables" | "errorMessage">>) {
    this.dependencies.workflowRuns.update(workflowRunId, changes);
  }

  private async runNode(node: WorkflowNode, run: WorkflowRun, workspaceId: string, variables: Record<string, string>): Promise<string> {
    switch (node.type) {
      case "prompt":
        return this.runAgentNode(run, workspaceId, renderTemplate(node.promptTemplate, variables));
      case "skill":
        return this.runAgentNode(run, workspaceId, `Execute the "${node.label}" step.`, renderTemplate(node.skillId, variables));
      case "tool":
        return this.runToolNode(node, run, workspaceId, variables);
      case "user_input":
        throw new Error("user_input nodes must be handled by execute(), not runNode()");
    }
  }

  private async runAgentNode(run: WorkflowRun, workspaceId: string, prompt: string, forcedSkillId?: string): Promise<string> {
    const agentRun = this.dependencies.runs.create(run.sessionId, run.rootRunId ?? null);
    this.dependencies.sessions.addMessage(run.sessionId, "user", prompt, agentRun.id);
    await this.dependencies.agent.run(agentRun.id, run.sessionId, workspaceId, prompt, forcedSkillId);

    const state = this.dependencies.runs.getActive(agentRun.id);
    const failed = state?.events.some((event) => event.type === "run.failed" || event.type === "run.cancelled") ?? false;
    if (failed) throw new Error(`Agent step failed for run ${agentRun.id}`);

    const messages = this.dependencies.sessions.listMessages(run.sessionId);
    const output = [...messages].reverse().find((message) => message.runId === agentRun.id && message.role === "assistant");
    return output?.content ?? "";
  }

  private async runToolNode(
    node: Extract<WorkflowNode, { type: "tool" }>,
    run: WorkflowRun,
    workspaceId: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const tool = this.dependencies.tools.get(node.toolName);
    if (!tool) throw new Error(`Unknown tool: ${node.toolName}`);

    const rawInput = Object.fromEntries(
      Object.entries(node.argsTemplate).map(([key, template]) => [key, coerceTemplateValue(renderTemplate(template, variables))]),
    );
    const agentRun = this.dependencies.runs.create(run.sessionId, run.rootRunId ?? null);
    const callId = agentRun.id;
    this.dependencies.sessions.addMessage(run.sessionId, "assistant", `Running step "${node.label}" (${tool.name})…`, agentRun.id);
    this.dependencies.runs.emit(agentRun.id, { type: "run.started", runId: agentRun.id });

    const workspaceRoot = this.dependencies.workspaces
      ? await this.dependencies.workspaces.resolve(workspaceId)
      : this.dependencies.workspaceRoot;
    if (!workspaceRoot) throw new Error("Workspace root is required");
    const outcome = await this.dependencies.toolExecutor.execute({
      runId: agentRun.id,
      callId,
      toolName: tool.name,
      rawInput,
      serializedInput: JSON.stringify(rawInput),
      workspaceId,
      workspaceRoot,
      signal: agentRun.controller.signal,
    });
    if (outcome.status !== "succeeded") {
      this.dependencies.runs.emit(agentRun.id, { type: "run.failed", message: outcome.content });
      throw new Error(outcome.content);
    }
    this.dependencies.runs.emit(agentRun.id, { type: "run.completed" });
    return outcome.content;
  }

  private emitRoot(run: WorkflowRun, event: Parameters<RunService["emit"]>[1]) {
    if (run.rootRunId && this.dependencies.runs.getActive(run.rootRunId)) {
      this.dependencies.runs.emit(run.rootRunId, event);
    }
  }
}
