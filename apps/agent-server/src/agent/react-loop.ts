import type { LlmProvider } from "../llm/llm-provider.js";
import type { LlmMessage } from "../llm/llm-types.js";
import type { AutoMemoryRepository } from "../memory/auto-memory-repository.js";
import { WorkingMemory } from "../memory/working-memory.js";
import type { ApprovalService } from "../permissions/approval-service.js";
import type { PermissionService } from "../permissions/permission-service.js";
import type { RunService } from "../sessions/run-service.js";
import type { SessionService } from "../sessions/session-service.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { AgentConfig } from "./agent-config.js";

interface ReactLoopDependencies {
  llm: LlmProvider;
  tools: ToolRegistry;
  permissions: PermissionService;
  approvals: ApprovalService;
  runs: RunService;
  sessions: SessionService;
  autoMemories: AutoMemoryRepository;
  workspaceRoot?: string;
}

export class ReactLoop {
  constructor(private readonly dependencies: ReactLoopDependencies) {}

  async run(config: AgentConfig, runId: string, workspaceId: string, messages: LlmMessage[], allowedTools: string[] | null = null, workspaceRoot?: string) {
    const run = this.dependencies.runs.get(runId);
    if (!run) throw new Error("Run not found");
    const activeWorkspaceRoot = workspaceRoot ?? this.dependencies.workspaceRoot;
    if (!activeWorkspaceRoot) throw new Error("Workspace root is required");

    console.log(`[react-loop] run started runId=${runId} sessionId=${run.sessionId} initialMessages=${messages.length} allowedTools=${allowedTools ? allowedTools.join(",") : "all"}`);
    const workingMemory = new WorkingMemory();
    const conversation: LlmMessage[] = [...messages];

    try {
      for (let iteration = 0; iteration < config.maxIterations; iteration++) {
        console.log(`[react-loop] iteration ${iteration + 1} runId=${runId}`);
        this.dependencies.runs.emit(runId, { type: "status", label: `Reasoning (step ${iteration + 1})` });
        const response = await this.dependencies.llm.complete({
          messages: conversation,
          tools: this.dependencies.tools.definitions(allowedTools),
          signal: run.controller.signal,
        });
        console.log(`[react-loop] llm responded runId=${runId} toolCalls=${response.toolCalls.length} hasContent=${Boolean(response.content)}`);

        if (response.toolCalls.length === 0) {
          const content = response.content?.trim();
          if (!content) throw new Error("Agent returned no final response");
          this.dependencies.sessions.addMessage(run.sessionId, "assistant", content, runId);
          this.dependencies.runs.emit(runId, { type: "message.delta", text: content });
          this.dependencies.runs.emit(runId, { type: "run.completed" });
          console.log(`[react-loop] run completed runId=${runId}`);
          await this.captureAutoMemory(workspaceId, run.sessionId, runId, workingMemory, content);
          return;
        }

        conversation.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
        const toolResults: LlmMessage[] = [];

        for (const call of response.toolCalls) {
          const tool = this.dependencies.tools.get(call.name);
          if (!tool || (allowedTools && !allowedTools.includes(call.name))) {
            console.warn(`[react-loop] unknown or disallowed tool requested runId=${runId} tool=${call.name}`);
            toolResults.push({ role: "tool", toolCallId: call.id, content: `Unknown tool: ${call.name}` });
            continue;
          }

          const parsedArguments: unknown = JSON.parse(call.arguments);
          const input = tool.inputSchema.parse(parsedArguments);
          console.log(`[react-loop] tool requested runId=${runId} tool=${tool.name} callId=${call.id}`);
          this.dependencies.runs.emit(runId, {
            type: "tool.requested",
            callId: call.id,
            tool: tool.name,
            source: tool.source ?? "local",
            ...(tool.mcpServer ? { mcpServer: tool.mcpServer } : {}),
            arguments: call.arguments,
            summary: `Calling ${tool.name}`,
          });

          const evaluation = this.dependencies.permissions.evaluate(tool, input, workspaceId);
          if (evaluation.decision === "deny") {
            console.log(`[react-loop] tool denied by rule runId=${runId} tool=${tool.name} callId=${call.id} rule=${evaluation.matchedRuleId}`);
            const reason = `Denied by permission rule${evaluation.matchedRuleId ? ` (${evaluation.matchedRuleId})` : ""}: ${tool.name}`;
            this.dependencies.runs.emit(runId, {
              type: "tool.denied",
              callId: call.id,
              tool: tool.name,
              reason,
              matchedRuleId: evaluation.matchedRuleId,
            });
            toolResults.push({ role: "tool", toolCallId: call.id, content: reason });
            workingMemory.addObservation({ tool: tool.name, summary: reason, succeeded: false });
            continue;
          }

          if (evaluation.requiresApproval) {
            console.log(`[react-loop] approval required runId=${runId} tool=${tool.name} callId=${call.id}`);
            this.dependencies.runs.emit(runId, {
              type: "approval.required",
              callId: call.id,
              tool: tool.name,
              summary: `${tool.name}: ${JSON.stringify(input).slice(0, 1000)}`,
              risk: this.dependencies.permissions.displayRisk(tool.risk),
              matchedRuleId: evaluation.matchedRuleId,
            });
            const decision = await this.dependencies.approvals.wait(call.id, runId, run.controller.signal);
            console.log(`[react-loop] approval decision runId=${runId} callId=${call.id} decision=${decision}`);
            if (decision === "deny") {
              const observation = `User denied tool execution: ${tool.name}`;
              toolResults.push({ role: "tool", toolCallId: call.id, content: observation });
              workingMemory.addObservation({ tool: tool.name, summary: observation, succeeded: false });
              continue;
            }
          }

          const result = await tool.execute(input, {
            workspaceRoot: activeWorkspaceRoot,
            signal: run.controller.signal,
          });
          console.log(`[react-loop] tool completed runId=${runId} tool=${tool.name} callId=${call.id}`);
          toolResults.push({ role: "tool", toolCallId: call.id, content: result.content });
          workingMemory.addObservation({ tool: tool.name, summary: result.summary, succeeded: true });
          this.dependencies.runs.emit(runId, {
            type: "tool.completed",
            callId: call.id,
            tool: tool.name,
            result: result.content,
            summary: result.summary,
          });
        }

        conversation.push(...toolResults);
      }

      throw new Error(`Agent reached the ${config.maxIterations}-iteration limit`);
    } catch (error) {
      if (run.controller.signal.aborted) {
        console.warn(`[react-loop] run cancelled runId=${runId}`);
        this.dependencies.runs.emit(runId, { type: "run.cancelled" });
        return;
      }
      console.error(`[react-loop] run failed runId=${runId}`, error);
      this.dependencies.runs.emit(runId, {
        type: "run.failed",
        message: error instanceof Error ? error.message : "Unknown agent error",
      });
    }
  }

  private async captureAutoMemory(
    workspaceId: string,
    sessionId: string,
    runId: string,
    workingMemory: WorkingMemory,
    finalContent: string,
  ) {
    const succeededSteps = workingMemory.observations.filter((observation) => observation.succeeded);
    if (succeededSteps.length === 0) return;

    const stepsSummary = succeededSteps.map((observation) => `${observation.tool}: ${observation.summary}`).join("; ");
    const content = `${stepsSummary}\n=> ${finalContent.slice(0, 500)}`;
    console.log(`[react-loop] capturing auto memory runId=${runId} steps=${succeededSteps.length}`);
    await this.dependencies.autoMemories.add(workspaceId, sessionId, runId, content);
  }
}
