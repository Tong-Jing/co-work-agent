import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentEvent } from "@local-agent/contracts";

type UnsequencedAgentEvent = AgentEvent extends infer TEvent
  ? TEvent extends AgentEvent
    ? Omit<TEvent, "sequence">
    : never
  : never;

export type RunStatus = "created" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

const terminalEventStatus = {
  "run.completed": "completed",
  "run.failed": "failed",
  "run.cancelled": "cancelled",
} as const satisfies Partial<Record<AgentEvent["type"], RunStatus>>;

const terminalStatuses = new Set<RunStatus>(["completed", "failed", "cancelled", "interrupted"]);

interface RunState {
  id: string;
  sessionId: string;
  parentRunId: string | null;
  status: RunStatus;
  controller: AbortController;
  events: AgentEvent[];
  listeners: Set<(event: AgentEvent) => void>;
  sequence: number;
}

export class RunService {
  readonly #runs = new Map<string, RunState>();

  constructor(private readonly database: DatabaseSync) {
    this.database
      .prepare("UPDATE agent_runs SET status = 'interrupted', updated_at = ?, finished_at = ? WHERE status IN ('created', 'running')")
      .run(new Date().toISOString(), new Date().toISOString());
  }

  create(sessionId: string, parentRunId: string | null = null) {
    const now = new Date().toISOString();
    const run: RunState = {
      id: randomUUID(),
      sessionId,
      parentRunId,
      status: "created",
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      sequence: 0,
    };
    this.database
      .prepare("INSERT INTO agent_runs (id, session_id, parent_run_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.id, sessionId, parentRunId, run.status, now, now);
    this.#runs.set(run.id, run);
    return run;
  }

  get(runId: string) {
    const active = this.#runs.get(runId);
    if (active) return active;

    const row = this.database
      .prepare("SELECT id, session_id AS sessionId, parent_run_id AS parentRunId, status, iteration, checkpoint, checkpoint_sequence AS checkpointSequence, error_message AS errorMessage, last_sequence AS lastSequence, created_at AS createdAt, updated_at AS updatedAt, finished_at AS finishedAt FROM agent_runs WHERE id = ?")
      .get(runId) as unknown as PersistedRun | undefined;
    return row ?? undefined;
  }

  getActive(runId: string) {
    return this.#runs.get(runId);
  }

  emit(runId: string, event: UnsequencedAgentEvent) {
    const run = this.#runs.get(runId);
    if (!run) throw new Error("Run not found");
    const nextStatus = terminalEventStatus[event.type as keyof typeof terminalEventStatus]
      ?? (event.type === "run.started" ? "running" : run.status);
    if (terminalStatuses.has(run.status)) return false;

    const sequenced = { ...event, sequence: ++run.sequence } as AgentEvent;
    const now = new Date().toISOString();
    const errorMessage = event.type === "run.failed" ? event.message : null;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("INSERT INTO run_events (id, session_id, run_id, sequence, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), run.sessionId, run.id, sequenced.sequence, sequenced.type, JSON.stringify(sequenced), now);
      this.database
        .prepare("UPDATE agent_runs SET status = ?, last_sequence = ?, error_message = COALESCE(?, error_message), updated_at = ?, finished_at = ? WHERE id = ?")
        .run(nextStatus, sequenced.sequence, errorMessage, now, terminalStatuses.has(nextStatus) ? now : null, run.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      run.sequence -= 1;
      throw error;
    }
    run.status = nextStatus;
    run.events.push(sequenced);
    for (const listener of run.listeners) listener(sequenced);
    if (run.parentRunId && !terminalEventStatus[event.type as keyof typeof terminalEventStatus]) {
      this.emit(run.parentRunId, event);
    }
    return true;
  }

  subscribe(runId: string, listener: (event: AgentEvent) => void, afterSequence = 0) {
    const run = this.#runs.get(runId);
    const events = run?.events ?? this.loadEvents(runId);
    if (!run && events.length === 0 && !this.get(runId)) return null;
    for (const event of events.filter((item) => item.sequence > afterSequence)) listener(event);
    if (!run || terminalStatuses.has(run.status)) return () => false;
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  cancel(runId: string) {
    const run = this.#runs.get(runId);
    if (!run) return false;
    run.controller.abort(new Error("Cancelled by user"));
    for (const child of this.#runs.values()) {
      if (child.parentRunId === runId) child.controller.abort(new Error("Parent run cancelled"));
    }
    return true;
  }

  saveCheckpoint(runId: string, iteration: number, checkpoint: unknown) {
    const result = this.database
      .prepare("UPDATE agent_runs SET iteration = ?, checkpoint = ?, checkpoint_sequence = last_sequence, updated_at = ? WHERE id = ? AND status = 'running'")
      .run(iteration, JSON.stringify(checkpoint), new Date().toISOString(), runId);
    return Number(result.changes) > 0;
  }

  resume(runId: string) {
    const persisted = this.get(runId);
    if (!persisted || "controller" in persisted || persisted.status !== "interrupted" || !persisted.checkpoint) return null;
    if (persisted.checkpointSequence !== persisted.lastSequence) return null;

    const run: RunState = {
      id: persisted.id,
      sessionId: persisted.sessionId,
      parentRunId: persisted.parentRunId,
      status: "running",
      controller: new AbortController(),
      events: this.loadEvents(runId),
      listeners: new Set(),
      sequence: persisted.lastSequence,
    };
    const now = new Date().toISOString();
    const result = this.database
      .prepare("UPDATE agent_runs SET status = 'running', updated_at = ?, finished_at = NULL WHERE id = ? AND status = 'interrupted' AND checkpoint_sequence = last_sequence")
      .run(now, runId);
    if (Number(result.changes) === 0) return null;
    this.#runs.set(runId, run);
    return { run, checkpoint: JSON.parse(persisted.checkpoint) as unknown, iteration: persisted.iteration };
  }

  private loadEvents(runId: string): AgentEvent[] {
    const rows = this.database
      .prepare("SELECT payload FROM run_events WHERE run_id = ? ORDER BY sequence")
      .all(runId) as unknown as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as AgentEvent);
  }

  listEventsBySession(sessionId: string) {
    const rows = this.database
      .prepare("SELECT run_id AS runId, payload FROM run_events WHERE session_id = ? ORDER BY run_id, sequence")
      .all(sessionId) as unknown as Array<{ runId: string; payload: string }>;

    const grouped = new Map<string, AgentEvent[]>();
    for (const row of rows) {
      const events = grouped.get(row.runId) ?? [];
      events.push(JSON.parse(row.payload) as AgentEvent);
      grouped.set(row.runId, events);
    }
    return [...grouped.entries()].map(([runId, events]) => ({ runId, events }));
  }
}

interface PersistedRun {
  id: string;
  sessionId: string;
  parentRunId: string | null;
  status: RunStatus;
  iteration: number;
  checkpoint: string | null;
  checkpointSequence: number;
  errorMessage: string | null;
  lastSequence: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
