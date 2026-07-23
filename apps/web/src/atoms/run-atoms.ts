import type { AgentEvent } from "@local-agent/contracts";
import { atom } from "jotai";
import { currentSessionIdAtom } from "./current-session-atom";
import { currentWorkspaceIdAtom } from "./workspace-atom";

export interface ActiveRunState {
  runId: string | null;
  status: "idle" | "running" | "waiting-approval" | "completed" | "failed" | "cancelled";
  connectionStatus: "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
  response: string;
  events: AgentEvent[];
}

const emptyRun: ActiveRunState = {
  runId: null,
  status: "idle",
  connectionStatus: "idle",
  response: "",
  events: [],
};

const runStatesAtom = atom<Record<string, ActiveRunState>>({});

export function runContextKey(workspaceId: string | null, sessionId: string | null) {
  return `${workspaceId ?? "none"}:${sessionId ?? "none"}`;
}

export const activeRunAtom = atom(
  (get) => get(runStatesAtom)[runContextKey(get(currentWorkspaceIdAtom), get(currentSessionIdAtom))] ?? emptyRun,
  (get, set, update: ActiveRunState | ((current: ActiveRunState) => ActiveRunState)) => {
    const key = runContextKey(get(currentWorkspaceIdAtom), get(currentSessionIdAtom));
    const current = get(runStatesAtom)[key] ?? emptyRun;
    set(runStatesAtom, (states) => ({ ...states, [key]: typeof update === "function" ? update(current) : update }));
  },
);

export const updateRunConnectionAtom = atom(null, (get, set, input: { key: string; status: ActiveRunState["connectionStatus"] }) => {
  const current = get(runStatesAtom)[input.key] ?? emptyRun;
  set(runStatesAtom, (states) => ({ ...states, [input.key]: { ...current, connectionStatus: input.status } }));
});

export const updateRunStatusAtom = atom(null, (get, set, input: { key: string; runId: string; status: ActiveRunState["status"] }) => {
  const current = get(runStatesAtom)[input.key] ?? emptyRun;
  if (current.runId !== input.runId) return;
  set(runStatesAtom, (states) => ({ ...states, [input.key]: { ...current, status: input.status } }));
});

export const setRunStateAtom = atom(null, (_get, set, input: { key: string; state: ActiveRunState }) => {
  set(runStatesAtom, (states) => ({ ...states, [input.key]: input.state }));
});

export const appendRunEventAtom = atom(null, (get, set, input: { key: string; event: AgentEvent }) => {
  const current = get(runStatesAtom)[input.key] ?? emptyRun;
  const event = input.event;
  if (current.events.some((existing) => existing.sequence === event.sequence)) return;

  const status = event.type === "approval.required"
    ? "waiting-approval"
    : event.type === "run.completed"
      ? "completed"
      : event.type === "run.failed"
        ? "failed"
        : event.type === "run.cancelled"
          ? "cancelled"
          : current.status;
  set(runStatesAtom, (states) => ({ ...states, [input.key]: {
    ...current,
    status,
    response: event.type === "message.delta" ? current.response + event.text : current.response,
    events: [...current.events, event],
  } }));
});
