import type { Agent } from "./agent.js";
import type { RunService } from "../sessions/run-service.js";
import type { SessionService } from "../sessions/session-service.js";
import type { LlmMessage } from "../llm/llm-types.js";

export class RunController {
  constructor(
    private readonly agent: Agent,
    private readonly runs: RunService,
    private readonly sessions: SessionService,
  ) {}

  start(sessionId: string, prompt: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    this.sessions.renameFromFirstMessage(sessionId, prompt);
    const run = this.runs.create(sessionId);
    this.sessions.addMessage(sessionId, "user", prompt, run.id);
    console.log(`[run-controller] starting agent run runId=${run.id} sessionId=${sessionId} workspaceId=${session.workspaceId}`);
    void this.agent.run(run.id, sessionId, session.workspaceId, prompt).catch((error) => {
      console.error(`[run-controller] agent.run threw unexpectedly runId=${run.id}`, error);
    });
    return run.id;
  }

  cancel(runId: string) {
    return this.runs.cancel(runId);
  }

  resume(runId: string) {
    const persisted = this.runs.get(runId);
    if (!persisted || "controller" in persisted || !persisted.checkpoint) return false;
    const checkpoint = JSON.parse(persisted.checkpoint) as { messages?: LlmMessage[]; allowedTools?: string[] | null };
    if (!Array.isArray(checkpoint.messages) || !hasCompleteToolResults(checkpoint.messages)) return false;
    const session = this.sessions.get(persisted.sessionId);
    if (!session) return false;
    const resumed = this.runs.resume(runId);
    if (!resumed) return false;

    void this.agent.resume(runId, session.workspaceId, checkpoint.messages, checkpoint.allowedTools ?? null).catch((error) => {
      console.error(`[run-controller] resumed agent.run threw unexpectedly runId=${runId}`, error);
    });
    return true;
  }
}

function hasCompleteToolResults(messages: LlmMessage[]): boolean {
  const expected = new Set(messages.flatMap((message) => message.role === "assistant" ? (message.toolCalls ?? []).map((call) => call.id) : []));
  for (const message of messages) {
    if (message.role === "tool") expected.delete(message.toolCallId);
  }
  return expected.size === 0;
}
