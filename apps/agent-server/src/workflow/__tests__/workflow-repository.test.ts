import { describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { WorkflowRepository } from "../workflow-repository.js";

function setup() {
  const database = createDatabase(":memory:");
  const workspaceId = (database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string }).id;
  return { repository: new WorkflowRepository(database), workspaceId };
}

describe("WorkflowRepository", () => {
  it("creates and retrieves a workflow with its node graph intact", () => {
    const { repository, workspaceId } = setup();
    const created = repository.add({
      workspaceId,
      name: "PRD to PRs",
      description: "PRD -> design -> impl -> PR",
      version: "1.0.0",
      nodes: [
        { id: "n1", type: "skill", label: "PRD to Design", skillId: "prd-to-design", outputVariable: "design_doc" },
        { id: "n2", type: "tool", label: "Create PR", toolName: "git_commit", argsTemplate: { message: "{{design_doc}}", files: "[]" }, outputVariable: "pr_result" },
      ],
    });

    const fetched = repository.get(created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.nodes).toHaveLength(2);
  });

  it("lists workflows scoped to a workspace", () => {
    const { repository, workspaceId } = setup();
    repository.add({ workspaceId, name: "A", description: "", version: "1.0.0", nodes: [] });
    repository.add({ workspaceId, name: "B", description: "", version: "1.0.0", nodes: [] });

    expect(repository.listForWorkspace(workspaceId)).toHaveLength(2);
    expect(repository.listForWorkspace("other-workspace")).toEqual([]);
  });

  it("updates only the provided fields", () => {
    const { repository, workspaceId } = setup();
    const created = repository.add({ workspaceId, name: "A", description: "desc", version: "1.0.0", nodes: [] });

    const updated = repository.update(created.id, { name: "Renamed" });

    expect(updated).toMatchObject({ name: "Renamed", description: "desc", version: "1.0.0" });
    expect(updated!.updatedAt).toBeTruthy();
  });

  it("returns null when updating a nonexistent workflow", () => {
    const { repository } = setup();
    expect(repository.update("nonexistent", { name: "x" })).toBeNull();
  });

  it("removes a workflow", () => {
    const { repository, workspaceId } = setup();
    const created = repository.add({ workspaceId, name: "A", description: "", version: "1.0.0", nodes: [] });

    expect(repository.remove(created.id)).toBe(true);
    expect(repository.get(created.id)).toBeNull();
    expect(repository.remove(created.id)).toBe(false);
  });
});
