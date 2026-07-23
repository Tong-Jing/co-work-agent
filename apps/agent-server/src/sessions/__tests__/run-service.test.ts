import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { SessionService } from "../session-service.js";
import { RunService } from "../run-service.js";

describe("RunService", () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  function setup() {
    database = createDatabase(":memory:");
    const workspace = database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string };
    const session = new SessionService(database).create(workspace.id);
    return { database, runs: new RunService(database), session };
  }

  it("persists lifecycle state and accepts only one terminal event", () => {
    const { database, runs, session } = setup();
    const run = runs.create(session.id);

    expect(runs.emit(run.id, { type: "run.started", runId: run.id })).toBe(true);
    expect(runs.emit(run.id, { type: "run.completed" })).toBe(true);
    expect(runs.emit(run.id, { type: "run.failed", message: "late failure" })).toBe(false);

    expect(runs.get(run.id)).toEqual(expect.objectContaining({ status: "completed" }));
    expect(database.prepare("SELECT event_type AS type FROM run_events WHERE run_id = ? ORDER BY sequence").all(run.id))
      .toEqual([{ type: "run.started" }, { type: "run.completed" }]);
  });

  it("replays persisted events after a service restart and marks active runs interrupted", () => {
    const { database, runs, session } = setup();
    const run = runs.create(session.id);
    runs.emit(run.id, { type: "run.started", runId: run.id });
    runs.emit(run.id, { type: "status", label: "working" });

    const restarted = new RunService(database);
    const replayed: string[] = [];
    restarted.subscribe(run.id, (event) => replayed.push(event.type));

    expect(restarted.get(run.id)).toEqual(expect.objectContaining({ status: "interrupted", lastSequence: 2 }));
    expect(replayed).toEqual(["run.started", "status"]);
    expect(restarted.cancel(run.id)).toBe(false);
  });

  it("persists checkpoints only for running runs", () => {
    const { runs, session } = setup();
    const run = runs.create(session.id);
    runs.emit(run.id, { type: "run.started", runId: run.id });

    expect(runs.saveCheckpoint(run.id, 2, { messages: ["hello"] })).toBe(true);
    expect(runs.get(run.id)).toEqual(expect.objectContaining({ status: "running" }));
    runs.emit(run.id, { type: "run.cancelled" });
    expect(runs.saveCheckpoint(run.id, 3, {})).toBe(false);
  });

  it("resumes an interrupted run only when its checkpoint matches the last event", () => {
    const { database, runs, session } = setup();
    const run = runs.create(session.id);
    runs.emit(run.id, { type: "run.started", runId: run.id });
    runs.saveCheckpoint(run.id, 1, { messages: [{ role: "user", content: "continue" }] });

    const restarted = new RunService(database);
    const resumed = restarted.resume(run.id);

    expect(resumed).toEqual(expect.objectContaining({ iteration: 1 }));
    expect(resumed?.run.status).toBe("running");
    expect(restarted.getActive(run.id)).toBe(resumed?.run);
  });

  it("refuses to resume when events were emitted after the last checkpoint", () => {
    const { database, runs, session } = setup();
    const run = runs.create(session.id);
    runs.emit(run.id, { type: "run.started", runId: run.id });
    runs.saveCheckpoint(run.id, 1, { messages: [] });
    runs.emit(run.id, { type: "tool.requested", callId: "call-1", tool: "write_file", source: "local", arguments: "{}", summary: "write" });

    const restarted = new RunService(database);
    expect(restarted.resume(run.id)).toBeNull();
  });

  it("mirrors child events to its parent and cascades cancellation", () => {
    const { runs, session } = setup();
    const parent = runs.create(session.id);
    const child = runs.create(session.id, parent.id);
    runs.emit(parent.id, { type: "run.started", runId: parent.id });
    runs.emit(child.id, { type: "run.started", runId: child.id });
    runs.emit(child.id, { type: "message.delta", text: "child output" });

    expect(parent.events.some((event) => event.type === "message.delta" && event.text === "child output")).toBe(true);
    expect(runs.cancel(parent.id)).toBe(true);
    expect(parent.controller.signal.aborted).toBe(true);
    expect(child.controller.signal.aborted).toBe(true);
  });
});