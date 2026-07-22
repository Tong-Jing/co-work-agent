import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateMemoryRequest, MemoryEntry } from "@local-agent/contracts";
import { cosineSimilarity } from "./similarity.js";

export interface LongTermMemoryItem {
  id: string;
  workspaceId: string;
  category: string;
  content: string;
  createdAt: string;
  embedding: number[] | null;
}

interface MemoryRow {
  id: string;
  workspaceId: string;
  category: string;
  content: string;
  createdAt: string;
  embedding: string | null;
}

interface MemoryEntryRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  category: string;
  content: string;
  createdAt: string;
  status: "active" | "superseded";
  supersededBy: string | null;
  lastRecalledAt: string | null;
  recallCount: number;
}

const ENTRY_SELECT_COLUMNS = `
  memories.id AS id, memories.workspace_id AS workspaceId, workspaces.name AS workspaceName,
  memories.category AS category, memories.content AS content, memories.created_at AS createdAt,
  memories.status AS status, memories.superseded_by AS supersededBy,
  memories.last_recalled_at AS lastRecalledAt, memories.recall_count AS recallCount
`;

export class MemoryRepository {
  constructor(private readonly database: DatabaseSync) {}

  add(item: LongTermMemoryItem) {
    this.database
      .prepare(
        "INSERT INTO memories (id, workspace_id, category, content, created_at, embedding, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      )
      .run(item.id, item.workspaceId, item.category, item.content, item.createdAt, serializeEmbedding(item.embedding));
  }

  listActiveForWorkspace(workspaceId: string): LongTermMemoryItem[] {
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, category, content, created_at AS createdAt, embedding FROM memories WHERE workspace_id = ? AND status = 'active'",
      )
      .all(workspaceId) as unknown as MemoryRow[];
    return rows.map(toItem);
  }

  /** Bumps recall stats for memories that were surfaced by LongTermMemory.recall(), for UI visibility into usage. */
  recordRecall(ids: string[]) {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const statement = this.database.prepare(
      "UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?",
    );
    for (const id of ids) statement.run(now, id);
  }

  listAllAcrossWorkspaces(): MemoryEntry[] {
    return (this.database
      .prepare(`
        SELECT ${ENTRY_SELECT_COLUMNS}
        FROM memories
        JOIN workspaces ON workspaces.id = memories.workspace_id
        WHERE memories.status = 'active'
        ORDER BY memories.created_at DESC
      `)
      .all() as unknown as MemoryEntryRow[]).map(toEntry);
  }

  listArchivedAcrossWorkspaces(): MemoryEntry[] {
    return (this.database
      .prepare(`
        SELECT ${ENTRY_SELECT_COLUMNS}
        FROM memories
        JOIN workspaces ON workspaces.id = memories.workspace_id
        WHERE memories.status = 'superseded'
        ORDER BY memories.created_at DESC
      `)
      .all() as unknown as MemoryEntryRow[]).map(toEntry);
  }

  restore(id: string): boolean {
    const result = this.database
      .prepare("UPDATE memories SET status = 'active', superseded_by = NULL WHERE id = ? AND status = 'superseded'")
      .run(id);
    return Number(result.changes) > 0;
  }

  findSimilarActive(workspaceId: string, excludeId: string, embedding: number[], limit = 3): LongTermMemoryItem[] {
    return this.listActiveForWorkspace(workspaceId)
      .filter((item) => item.id !== excludeId && item.embedding !== null)
      .map((item) => ({ item, score: cosineSimilarity(embedding, item.embedding!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item }) => item);
  }

  supersede(id: string, supersededById: string) {
    this.database
      .prepare("UPDATE memories SET status = 'superseded', superseded_by = ? WHERE id = ?")
      .run(supersededById, id);
  }

  addFromRequest(input: CreateMemoryRequest & { embedding?: number[] | null }): MemoryEntry {
    const entry = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      category: input.category,
      content: input.content,
      createdAt: new Date().toISOString(),
      embedding: input.embedding ?? null,
    };
    this.add(entry);
    const workspace = this.database
      .prepare("SELECT name FROM workspaces WHERE id = ?")
      .get(entry.workspaceId) as unknown as { name: string } | undefined;
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      workspaceName: workspace?.name ?? "",
      category: entry.category,
      content: entry.content,
      createdAt: entry.createdAt,
      status: "active",
      supersededBy: null,
      lastRecalledAt: null,
      recallCount: 0,
    };
  }

  remove(id: string): boolean {
    const result = this.database.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }
}

function toItem(row: MemoryRow): LongTermMemoryItem {
  return { ...row, embedding: parseEmbedding(row.embedding) };
}

function toEntry(row: MemoryEntryRow): MemoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    category: row.category,
    content: row.content,
    createdAt: row.createdAt,
    status: row.status,
    supersededBy: row.supersededBy ?? null,
    lastRecalledAt: row.lastRecalledAt ?? null,
    recallCount: row.recallCount ?? 0,
  };
}

function serializeEmbedding(embedding: number[] | null): string | null {
  return embedding ? JSON.stringify(embedding) : null;
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return null;
  }
}
