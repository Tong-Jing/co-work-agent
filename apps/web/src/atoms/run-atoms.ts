import type { AgentEvent } from "@local-agent/contracts";
import { atom } from "jotai";

export interface ActiveRunState {
  runId: string | null;
  status: "idle" | "running" | "waiting-approval" | "completed" | "failed" | "cancelled";
  response: string;
  events: AgentEvent[];
}

export const activeRunAtom = atom<ActiveRunState>({
  runId: null,
  status: "idle",
  response: "",
  events: [],
});

export const appendRunEventAtom = atom(null, (get, set, event: AgentEvent) => {
  const current = get(activeRunAtom);
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
  set(activeRunAtom, {
    ...current,
    status,
    response: event.type === "message.delta" ? current.response + event.text : current.response,
    events: [...current.events, event],
  });
});
