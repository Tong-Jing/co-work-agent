import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentMessage, AgentSession } from "@local-agent/contracts";

const DEFAULT_TITLE = "New conversation";

export class SessionService {
  constructor(private readonly database: DatabaseSync) {}

  create(workspaceId: string, title = DEFAULT_TITLE): AgentSession {
    const now = new Date().toISOString();
    const session = { id: randomUUID(), workspaceId, title, createdAt: now, updatedAt: now };
    this.database
      .prepare("INSERT INTO sessions (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(session.id, session.workspaceId, session.title, session.createdAt, session.updatedAt);
    return session;
  }

  list(workspaceId: string): AgentSession[] {
    return this.database
      .prepare("SELECT id, workspace_id AS workspaceId, title, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC")
      .all(workspaceId) as unknown as AgentSession[];
  }

  get(id: string): AgentSession | null {
    return (this.database
      .prepare("SELECT id, workspace_id AS workspaceId, title, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE id = ?")
      .get(id) as unknown as AgentSession | undefined) ?? null;
  }

  renameFromFirstMessage(sessionId: string, prompt: string) {
    const session = this.get(sessionId);
    if (!session || session.title !== DEFAULT_TITLE) return;
    const collapsed = prompt.replace(/\s+/g, " ").trim();
    const title = collapsed.length > 60 ? `${collapsed.slice(0, 60)}…` : collapsed;
    if (!title) return;
    this.database
      .prepare("UPDATE sessions SET title = ? WHERE id = ?")
      .run(title, sessionId);
  }

  addMessage(sessionId: string, role: AgentMessage["role"], content: string, runId: string | null = null): AgentMessage {
    const message = { id: randomUUID(), sessionId, role, content, runId, createdAt: new Date().toISOString() };
    this.database
      .prepare("INSERT INTO messages (id, session_id, role, content, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(message.id, message.sessionId, message.role, message.content, message.runId, message.createdAt);
    this.database.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(message.createdAt, sessionId);
    return message;
  }

  listMessages(sessionId: string): Array<AgentMessage & { runId: string | null }> {
    return this.database
      .prepare("SELECT id, session_id AS sessionId, role, content, run_id AS runId, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY created_at")
      .all(sessionId) as unknown as Array<AgentMessage & { runId: string | null }>;
  }
}
