import type { ContextBuilder } from "./context-builder.js";
import type { AgentConfig } from "./agent-config.js";
import type { ReactLoop } from "./react-loop.js";
import type { RunService } from "../sessions/run-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { LlmMessage } from "../llm/llm-types.js";

export class Agent {
  constructor(
    readonly config: AgentConfig,
    private readonly contextBuilder: ContextBuilder,
    private readonly loop: ReactLoop,
    private readonly runs: RunService,
    private readonly workspaces: WorkspaceService,
  ) {}

  async run(runId: string, sessionId: string, workspaceId: string, prompt: string, forcedSkillId?: string) {
    this.runs.emit(runId, { type: "run.started", runId });
    try {
      const workspaceRoot = await this.workspaces.resolve(workspaceId);
      const { messages, allowedTools, gathered } = await this.contextBuilder.build(this.config, sessionId, workspaceId, prompt, workspaceRoot, forcedSkillId);
      this.runs.emit(runId, {
        type: "context.gathered",
        memoryCount: gathered.memoryCount,
        skillCount: gathered.skillCount,
        historyCount: gathered.historyCount,
        estimatedTokens: gathered.estimatedTokens,
        maxTokens: gathered.maxTokens,
        omittedMessages: gathered.omittedMessages,
        messageTokens: gathered.messageTokens,
        toolDefinitionTokens: gathered.toolDefinitionTokens,
        maxOutputTokens: this.config.maxOutputTokens,
      });
      return await this.loop.run(this.config, runId, workspaceId, messages, allowedTools, workspaceRoot);
    } catch (error) {
      this.runs.emit(runId, { type: "run.failed", message: error instanceof Error ? error.message : "Failed to build agent context" });
      throw error;
    }
  }

  async resume(runId: string, workspaceId: string, messages: LlmMessage[], allowedTools: string[] | null) {
    const workspaceRoot = await this.workspaces.resolve(workspaceId);
    this.runs.emit(runId, { type: "status", label: "Resuming interrupted run" });
    return this.loop.run(this.config, runId, workspaceId, messages, allowedTools, workspaceRoot);
  }
}
