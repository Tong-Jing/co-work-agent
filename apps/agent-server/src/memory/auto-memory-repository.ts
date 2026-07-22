import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AutoMemoryEntry } from "@local-agent/contracts";
import type { EmbeddingProvider } from "../llm/embedding-provider.js";
import type { LongTermMemory } from "./long-term-memory.js";
import { contentHash } from "./content-hash.js";

interface AutoMemoryRow {
  id: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
  content: string;
  sharedMemoryId: string | null;
  createdAt: string;
  hitCount: number;
}

export class AutoMemoryRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly memories: LongTermMemory,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async add(workspaceId: string, sessionId: string, runId: string, content: string): Promise<AutoMemoryEntry> {
    const hash = contentHash(content);
    const existing = this.findByContentHash(workspaceId, hash);
    if (existing) {
      this.touch(existing.id);
      return this.toEntry(existing);
    }

    const embedding = await this.embeddings.embed(content).catch(() => null);
    const row: AutoMemoryRow = {
      id: randomUUID(),
      workspaceId,
      sessionId,
      runId,
      content,
      sharedMemoryId: null,
      createdAt: new Date().toISOString(),
      hitCount: 1,
    };
    this.database
      .prepare(
        "INSERT INTO auto_memories (id, workspace_id, session_id, run_id, content, shared_memory_id, created_at, embedding, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.workspaceId,
        row.sessionId,
        row.runId,
        row.content,
        row.sharedMemoryId,
        row.createdAt,
        embedding ? JSON.stringify(embedding) : null,
        hash,
      );
    return this.toEntry(row);
  }

  private findByContentHash(workspaceId: string, hash: string): AutoMemoryRow | null {
    return (this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, session_id AS sessionId, run_id AS runId, content, shared_memory_id AS sharedMemoryId, created_at AS createdAt, hit_count AS hitCount FROM auto_memories WHERE workspace_id = ? AND content_hash = ?",
      )
      .get(workspaceId, hash) as unknown as AutoMemoryRow | undefined) ?? null;
  }

  private touch(id: string) {
    this.database
      .prepare("UPDATE auto_memories SET created_at = ?, hit_count = hit_count + 1 WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  listAllAcrossWorkspaces(): AutoMemoryEntry[] {
    const rows = this.database
      .prepare(`
        SELECT auto_memories.id AS id, auto_memories.workspace_id AS workspaceId, workspaces.name AS workspaceName,
               auto_memories.session_id AS sessionId, auto_memories.run_id AS runId,
               auto_memories.content AS content, auto_memories.shared_memory_id AS sharedMemoryId,
               auto_memories.created_at AS createdAt, auto_memories.hit_count AS hitCount
        FROM auto_memories
        JOIN workspaces ON workspaces.id = auto_memories.workspace_id
        ORDER BY auto_memories.created_at DESC
      `)
      .all() as unknown as Array<AutoMemoryRow & { workspaceName: string }>;
    return rows.map((row) => ({ ...row, sharedMemoryId: row.sharedMemoryId ?? null }));
  }

  get(id: string): (AutoMemoryRow & { workspaceName: string }) | null {
    return (this.database
      .prepare(`
        SELECT auto_memories.id AS id, auto_memories.workspace_id AS workspaceId, workspaces.name AS workspaceName,
               auto_memories.session_id AS sessionId, auto_memories.run_id AS runId,
               auto_memories.content AS content, auto_memories.shared_memory_id AS sharedMemoryId,
               auto_memories.created_at AS createdAt, auto_memories.hit_count AS hitCount
        FROM auto_memories
        JOIN workspaces ON workspaces.id = auto_memories.workspace_id
        WHERE auto_memories.id = ?
      `)
      .get(id) as unknown as (AutoMemoryRow & { workspaceName: string }) | undefined) ?? null;
  }

  async promote(id: string, category: string) {
    const autoMemory = this.get(id);
    if (!autoMemory) return null;
    if (autoMemory.sharedMemoryId) return null;

    const shared = await this.memories.rememberAndReturn(autoMemory.workspaceId, category, autoMemory.content);
    this.database
      .prepare("UPDATE auto_memories SET shared_memory_id = ? WHERE id = ?")
      .run(shared.id, id);
    return shared;
  }

  remove(id: string): boolean {
    const result = this.database.prepare("DELETE FROM auto_memories WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  private toEntry(row: AutoMemoryRow): AutoMemoryEntry {
    const workspace = this.database
      .prepare("SELECT name FROM workspaces WHERE id = ?")
      .get(row.workspaceId) as unknown as { name: string } | undefined;
    return { ...row, workspaceName: workspace?.name ?? "" };
  }
}
