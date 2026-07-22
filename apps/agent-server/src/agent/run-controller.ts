import type { Agent } from "./agent.js";
import type { RunService } from "../sessions/run-service.js";
import type { SessionService } from "../sessions/session-service.js";

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
}
