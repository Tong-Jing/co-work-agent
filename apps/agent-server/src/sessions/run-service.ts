import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AgentEvent } from "@local-agent/contracts";

type UnsequencedAgentEvent = AgentEvent extends infer TEvent
  ? TEvent extends AgentEvent
    ? Omit<TEvent, "sequence">
    : never
  : never;

interface RunState {
  id: string;
  sessionId: string;
  controller: AbortController;
  events: AgentEvent[];
  listeners: Set<(event: AgentEvent) => void>;
  sequence: number;
}

export class RunService {
  readonly #runs = new Map<string, RunState>();

  constructor(private readonly database: DatabaseSync) {}

  create(sessionId: string) {
    const run: RunState = {
      id: randomUUID(),
      sessionId,
      controller: new AbortController(),
      events: [],
      listeners: new Set(),
      sequence: 0,
    };
    this.#runs.set(run.id, run);
    return run;
  }

  get(runId: string) {
    return this.#runs.get(runId);
  }

  emit(runId: string, event: UnsequencedAgentEvent) {
    const run = this.#runs.get(runId);
    if (!run) throw new Error("Run not found");
    const sequenced = { ...event, sequence: ++run.sequence } as AgentEvent;
    run.events.push(sequenced);
    this.database
      .prepare("INSERT INTO run_events (id, session_id, run_id, sequence, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), run.sessionId, run.id, sequenced.sequence, sequenced.type, JSON.stringify(sequenced), new Date().toISOString());
    for (const listener of run.listeners) listener(sequenced);
  }

  subscribe(runId: string, listener: (event: AgentEvent) => void, afterSequence = 0) {
    const run = this.#runs.get(runId);
    if (!run) return null;
    for (const event of run.events.filter((item) => item.sequence > afterSequence)) listener(event);
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  cancel(runId: string) {
    const run = this.#runs.get(runId);
    if (!run) return false;
    run.controller.abort(new Error("Cancelled by user"));
    return true;
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
