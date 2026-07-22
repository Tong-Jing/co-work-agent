import type { ContextBuilder } from "./context-builder.js";
import type { AgentConfig } from "./agent-config.js";
import type { ReactLoop } from "./react-loop.js";
import type { RunService } from "../sessions/run-service.js";

export class Agent {
  constructor(
    readonly config: AgentConfig,
    private readonly contextBuilder: ContextBuilder,
    private readonly loop: ReactLoop,
    private readonly runs: RunService,
    private readonly workspaceRoot: string,
  ) {}

  async run(runId: string, sessionId: string, workspaceId: string, prompt: string, forcedSkillId?: string) {
    this.runs.emit(runId, { type: "run.started", runId });
    const { messages, allowedTools, gathered } = await this.contextBuilder.build(this.config, sessionId, workspaceId, prompt, this.workspaceRoot, forcedSkillId);
    this.runs.emit(runId, {
      type: "context.gathered",
      memoryCount: gathered.memoryCount,
      skillCount: gathered.skillCount,
      historyCount: gathered.historyCount,
    });
    return this.loop.run(this.config, runId, workspaceId, messages, allowedTools);
  }
}
