import type { SessionService } from "../sessions/session-service.js";

export class ConversationMemory {
  constructor(private readonly sessions: SessionService) {}

  getMessages(sessionId: string) {
    return this.sessions.listMessages(sessionId);
  }
}
