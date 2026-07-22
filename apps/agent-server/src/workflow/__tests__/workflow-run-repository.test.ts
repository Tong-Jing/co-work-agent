import { describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { WorkflowRepository } from "../workflow-repository.js";
import { WorkflowRunRepository } from "../workflow-run-repository.js";

function setup() {
  const database = createDatabase(":memory:");
  const workspaceId = (database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string }).id;
  const sessionId = "session-1";
  database
    .prepare("INSERT INTO sessions (id, title, created_at, updated_at, workspace_id) VALUES (?, ?, ?, ?, ?)")
    .run(sessionId, "Workflow: Test #1", new Date().toISOString(), new Date().toISOString(), workspaceId);

  const workflows = new WorkflowRepository(database);
  const workflow = workflows.add({ workspaceId, name: "Test", description: "", version: "1.0.0", nodes: [] });
  return { repository: new WorkflowRunRepository(database), workflowId: workflow.id, sessionId };
}

describe("WorkflowRunRepository", () => {
  it("creates a run with sensible defaults", () => {
    const { repository, workflowId, sessionId } = setup();
    const run = repository.create(workflowId, sessionId);

    expect(run).toMatchObject({
      workflowId,
      sessionId,
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
    });
  });

  it("updates status, node states, and variables", () => {
    const { repository, workflowId, sessionId } = setup();
    const run = repository.create(workflowId, sessionId);

    const updated = repository.update(run.id, {
      status: "completed",
      currentNodeId: "n2",
      nodeStates: { n1: { status: "succeeded", output: "done", startedAt: "t0", finishedAt: "t1" } },
      variables: { design_doc: "content" },
    });

    expect(updated).toMatchObject({
      status: "completed",
      currentNodeId: "n2",
      nodeStates: { n1: { status: "succeeded", output: "done" } },
      variables: { design_doc: "content" },
    });

    expect(repository.get(run.id)).toEqual(updated);
  });

  it("lists runs for a workflow ordered by most recent first", () => {
    const { repository, workflowId, sessionId } = setup();
    const first = repository.create(workflowId, sessionId);
    const second = repository.create(workflowId, sessionId);

    const runs = repository.listForWorkflow(workflowId);
    expect(runs.map((run) => run.id)).toEqual([second.id, first.id]);
  });

  it("returns null when updating a nonexistent run", () => {
    const { repository } = setup();
    expect(repository.update("nonexistent", { status: "failed" })).toBeNull();
  });
});
