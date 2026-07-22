import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateWorkflowRequest, UpdateWorkflowRequest, WorkflowDefinition, WorkflowNode } from "@local-agent/contracts";

interface WorkflowDefinitionRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  version: string;
  nodes: string;
  createdAt: string;
  updatedAt: string;
}

export class WorkflowRepository {
  constructor(private readonly database: DatabaseSync) {}

  listForWorkspace(workspaceId: string): WorkflowDefinition[] {
    const rows = this.database
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, description, version, nodes,
                created_at AS createdAt, updated_at AS updatedAt
         FROM workflow_definitions WHERE workspace_id = ? ORDER BY created_at`,
      )
      .all(workspaceId) as unknown as WorkflowDefinitionRow[];
    return rows.map(toDefinition);
  }

  get(id: string): WorkflowDefinition | null {
    const row = this.database
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, description, version, nodes,
                created_at AS createdAt, updated_at AS updatedAt
         FROM workflow_definitions WHERE id = ?`,
      )
      .get(id) as unknown as WorkflowDefinitionRow | undefined;
    return row ? toDefinition(row) : null;
  }

  add(input: CreateWorkflowRequest): WorkflowDefinition {
    const now = new Date().toISOString();
    const definition: WorkflowDefinition = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      version: input.version,
      nodes: input.nodes,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO workflow_definitions (id, workspace_id, name, description, version, nodes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(definition.id, definition.workspaceId, definition.name, definition.description, definition.version, JSON.stringify(definition.nodes), now, now);
    return definition;
  }

  update(id: string, changes: UpdateWorkflowRequest): WorkflowDefinition | null {
    const existing = this.get(id);
    if (!existing) return null;

    const next: WorkflowDefinition = {
      ...existing,
      name: changes.name ?? existing.name,
      description: changes.description ?? existing.description,
      version: changes.version ?? existing.version,
      nodes: changes.nodes ?? existing.nodes,
      updatedAt: new Date().toISOString(),
    };

    this.database
      .prepare(
        "UPDATE workflow_definitions SET name = ?, description = ?, version = ?, nodes = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.name, next.description, next.version, JSON.stringify(next.nodes), next.updatedAt, id);

    return next;
  }

  remove(id: string): boolean {
    const result = this.database.prepare("DELETE FROM workflow_definitions WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }
}

function toDefinition(row: WorkflowDefinitionRow): WorkflowDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    version: row.version,
    nodes: parseNodes(row.nodes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseNodes(raw: string): WorkflowNode[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkflowNode[]) : [];
  } catch {
    return [];
  }
}
