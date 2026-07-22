import { atom } from "jotai";

/** Set by WorkflowsPage after starting a run; ChatPage consumes and clears it to select the new session. */
export const pendingSessionSelectionAtom = atom<string | null>(null);
