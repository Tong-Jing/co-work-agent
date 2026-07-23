import type { LlmProvider } from "../llm/llm-provider.js";
import type { LlmMessage } from "../llm/llm-types.js";
import type { AutoMemoryRepository } from "../memory/auto-memory-repository.js";
import { WorkingMemory } from "../memory/working-memory.js";
import type { RunService } from "../sessions/run-service.js";
import type { SessionService } from "../sessions/session-service.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { AgentConfig } from "./agent-config.js";
import { applyContextBudget } from "./context-budget.js";
import type { ToolExecutor } from "../tools/tool-executor.js";

interface ReactLoopDependencies {
  llm: LlmProvider;
  tools: ToolRegistry;
  toolExecutor: ToolExecutor;
  runs: RunService;
  sessions: SessionService;
  autoMemories: AutoMemoryRepository;
  workspaceRoot?: string;
}

export class ReactLoop {
  constructor(private readonly dependencies: ReactLoopDependencies) {}

  async run(config: AgentConfig, runId: string, workspaceId: string, messages: LlmMessage[], allowedTools: string[] | null = null, workspaceRoot?: string) {
    const run = this.dependencies.runs.getActive(runId);
    if (!run) throw new Error("Run not found");
    const activeWorkspaceRoot = workspaceRoot ?? this.dependencies.workspaceRoot;
    if (!activeWorkspaceRoot) throw new Error("Workspace root is required");

    console.log(`[react-loop] run started runId=${runId} sessionId=${run.sessionId} initialMessages=${messages.length} allowedTools=${allowedTools ? allowedTools.join(",") : "all"}`);
    const workingMemory = new WorkingMemory();
    const conversation: LlmMessage[] = [...messages];
    const toolDefinitions = this.dependencies.tools.definitions(allowedTools);
    const initialCheckpoint = applyContextBudget(conversation, config.maxContextTokens, toolDefinitions);
    this.dependencies.runs.saveCheckpoint(runId, 0, { messages: initialCheckpoint.messages, allowedTools });
    const runTimeoutController = new AbortController();
    const runTimeout = setTimeout(
      () => runTimeoutController.abort(new Error(`Agent run timed out after ${config.runTimeoutMs}ms`)),
      config.runTimeoutMs,
    );
    const runSignal = AbortSignal.any([run.controller.signal, runTimeoutController.signal]);

    try {
      for (let iteration = 0; iteration < config.maxIterations; iteration++) {
        console.log(`[react-loop] iteration ${iteration + 1} runId=${runId}`);
        const budgeted = applyContextBudget(conversation, config.maxContextTokens, toolDefinitions);
        this.dependencies.runs.emit(runId, {
          type: "reasoning.started",
          iteration: iteration + 1,
          estimatedTokens: budgeted.estimatedTokens,
          omittedMessages: budgeted.omittedMessages,
        });
        this.dependencies.runs.saveCheckpoint(runId, iteration, { messages: budgeted.messages, allowedTools });
        if (budgeted.omittedMessages > 0) {
          console.log(`[react-loop] context compacted runId=${runId} omittedMessages=${budgeted.omittedMessages} estimatedTokens=${budgeted.estimatedTokens}`);
        }
        const response = await raceWithAbort(this.dependencies.llm.complete({
          messages: budgeted.messages,
          tools: toolDefinitions,
          maxOutputTokens: config.maxOutputTokens,
          signal: runSignal,
        }), runSignal);
        console.log(`[react-loop] llm responded runId=${runId} toolCalls=${response.toolCalls.length} hasContent=${Boolean(response.content)}`);
        if (response.usage) {
          console.log(`[react-loop] token usage runId=${runId} input=${response.usage.inputTokens} output=${response.usage.outputTokens} total=${response.usage.totalTokens}`);
        }

        if (response.toolCalls.length === 0) {
          const content = response.content?.trim();
          if (!content) throw new Error("Agent returned no final response");
          this.dependencies.runs.emit(runId, { type: "reasoning.completed", iteration: iteration + 1, decision: "final_response", toolCallCount: 0 });
          this.dependencies.sessions.addMessage(run.sessionId, "assistant", content, runId);
          this.dependencies.runs.emit(runId, { type: "message.delta", text: content });
          this.dependencies.runs.emit(runId, { type: "run.completed" });
          console.log(`[react-loop] run completed runId=${runId}`);
          await this.captureAutoMemory(workspaceId, run.sessionId, runId, workingMemory, content).catch((error) => {
            console.warn(`[react-loop] auto memory capture failed after completion runId=${runId}`, error);
          });
          return;
        }

        this.dependencies.runs.emit(runId, {
          type: "reasoning.completed",
          iteration: iteration + 1,
          decision: "tool_calls",
          toolCallCount: response.toolCalls.length,
        });
        conversation.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
        const toolResults: LlmMessage[] = [];

        for (const call of response.toolCalls) {
          const tool = this.dependencies.tools.get(call.name);
          if (!tool || (allowedTools && !allowedTools.includes(call.name))) {
            console.warn(`[react-loop] unknown or disallowed tool requested runId=${runId} tool=${call.name}`);
            toolResults.push({ role: "tool", toolCallId: call.id, content: `Unknown tool: ${call.name}` });
            continue;
          }

          try {
            const outcome = await this.dependencies.toolExecutor.execute({
              runId,
              callId: call.id,
              toolName: tool.name,
              serializedInput: call.arguments,
              workspaceId,
              workspaceRoot: activeWorkspaceRoot,
              signal: runSignal,
            });
            toolResults.push({ role: "tool", toolCallId: call.id, content: outcome.content });
            workingMemory.addObservation({ tool: tool.name, summary: outcome.summary, succeeded: outcome.status === "succeeded" });
            this.dependencies.runs.saveCheckpoint(runId, iteration, { messages: [...conversation, ...toolResults], allowedTools });
          } catch (error) {
            if (run.controller.signal.aborted) throw error;
            const message = error instanceof Error ? error.message : "Unknown tool error";
            const observation = `Tool ${tool.name} failed: ${message}`;
            console.warn(`[react-loop] tool failed runId=${runId} tool=${tool.name} callId=${call.id}`, error);
            toolResults.push({ role: "tool", toolCallId: call.id, content: observation });
            workingMemory.addObservation({ tool: tool.name, summary: observation, succeeded: false });
            this.dependencies.runs.saveCheckpoint(runId, iteration, { messages: [...conversation, ...toolResults], allowedTools });
          }
        }

        conversation.push(...toolResults);
        const checkpoint = applyContextBudget(conversation, config.maxContextTokens, toolDefinitions);
        conversation.splice(0, conversation.length, ...checkpoint.messages);
        this.dependencies.runs.saveCheckpoint(runId, iteration + 1, { messages: checkpoint.messages, allowedTools });
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
    } finally {
      clearTimeout(runTimeout);
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

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  ]);
}
