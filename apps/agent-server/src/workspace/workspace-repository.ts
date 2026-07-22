import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateWorkspaceRequest, Workspace } from "@local-agent/contracts";

export class WorkspaceRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): Workspace[] {
    return this.database
      .prepare("SELECT id, name, directory_name AS directoryName, created_at AS createdAt FROM workspaces ORDER BY created_at")
      .all() as unknown as Workspace[];
  }

  get(id: string): Workspace | null {
    return (this.database
      .prepare("SELECT id, name, directory_name AS directoryName, created_at AS createdAt FROM workspaces WHERE id = ?")
      .get(id) as unknown as Workspace | undefined) ?? null;
  }

  create(input: CreateWorkspaceRequest, directoryName: string): Workspace {
    const workspace = { id: randomUUID(), name: input.name, directoryName, createdAt: new Date().toISOString() };
    this.database
      .prepare("INSERT INTO workspaces (id, name, directory_name, created_at) VALUES (?, ?, ?, ?)")
      .run(workspace.id, workspace.name, workspace.directoryName, workspace.createdAt);
    return workspace;
  }
}
