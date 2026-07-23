import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkflowNodeState, WorkflowRun } from "@local-agent/contracts";

interface WorkflowRunRow {
  id: string;
  workflowId: string;
  sessionId: string;
  rootRunId: string | null;
  status: WorkflowRun["status"];
  currentNodeId: string | null;
  nodeStates: string;
  variables: string;
  errorMessage: string | null;
  createdAt: string;
}

export class WorkflowRunRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(workflowId: string, sessionId: string, rootRunId: string | null = null): WorkflowRun {
    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId,
      sessionId,
      rootRunId,
      status: "running",
      currentNodeId: null,
      nodeStates: {},
      variables: {},
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        "INSERT INTO workflow_runs (id, workflow_id, session_id, root_run_id, status, current_node_id, node_states, variables, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(run.id, run.workflowId, run.sessionId, run.rootRunId ?? null, run.status, run.currentNodeId, JSON.stringify(run.nodeStates), JSON.stringify(run.variables), run.errorMessage, run.createdAt);
    return run;
  }

  get(id: string): WorkflowRun | null {
    const row = this.database
      .prepare(
        `SELECT id, workflow_id AS workflowId, session_id AS sessionId, root_run_id AS rootRunId, status, current_node_id AS currentNodeId,
                node_states AS nodeStates, variables, error_message AS errorMessage, created_at AS createdAt
         FROM workflow_runs WHERE id = ?`,
      )
      .get(id) as unknown as WorkflowRunRow | undefined;
    return row ? toRun(row) : null;
  }

  listForWorkflow(workflowId: string): WorkflowRun[] {
    const rows = this.database
      .prepare(
        `SELECT id, workflow_id AS workflowId, session_id AS sessionId, root_run_id AS rootRunId, status, current_node_id AS currentNodeId,
                node_states AS nodeStates, variables, error_message AS errorMessage, created_at AS createdAt
         FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC`,
      )
      .all(workflowId) as unknown as WorkflowRunRow[];
    return rows.map(toRun);
  }

  getBySession(sessionId: string): WorkflowRun | null {
    const row = this.database
      .prepare(
        `SELECT id, workflow_id AS workflowId, session_id AS sessionId, root_run_id AS rootRunId, status, current_node_id AS currentNodeId,
                node_states AS nodeStates, variables, error_message AS errorMessage, created_at AS createdAt
         FROM workflow_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId) as unknown as WorkflowRunRow | undefined;
    return row ? toRun(row) : null;
  }

  update(id: string, changes: Partial<Pick<WorkflowRun, "status" | "currentNodeId" | "nodeStates" | "variables" | "errorMessage">>) {
    const existing = this.get(id);
    if (!existing) return null;

    const next: WorkflowRun = {
      ...existing,
      ...changes,
    };

    this.database
      .prepare(
        "UPDATE workflow_runs SET status = ?, current_node_id = ?, node_states = ?, variables = ?, error_message = ? WHERE id = ?",
      )
      .run(next.status, next.currentNodeId, JSON.stringify(next.nodeStates), JSON.stringify(next.variables), next.errorMessage, id);

    return next;
  }
}

function toRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflowId,
    sessionId: row.sessionId,
    rootRunId: row.rootRunId,
    status: row.status,
    currentNodeId: row.currentNodeId,
    nodeStates: parseRecord<WorkflowNodeState>(row.nodeStates),
    variables: parseRecord<string>(row.variables),
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}

function parseRecord<T>(raw: string): Record<string, T> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}
