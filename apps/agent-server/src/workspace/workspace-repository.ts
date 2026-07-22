import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateWorkspaceRequest, Workspace } from "@local-agent/contracts";

export class WorkspaceRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): Workspace[] {
    return this.database
      .prepare("SELECT id, name, created_at AS createdAt FROM workspaces ORDER BY created_at")
      .all() as unknown as Workspace[];
  }

  get(id: string): Workspace | null {
    return (this.database
      .prepare("SELECT id, name, created_at AS createdAt FROM workspaces WHERE id = ?")
      .get(id) as unknown as Workspace | undefined) ?? null;
  }

  create(input: CreateWorkspaceRequest): Workspace {
    const workspace = { id: randomUUID(), name: input.name, createdAt: new Date().toISOString() };
    this.database
      .prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.createdAt);
    return workspace;
  }
}
