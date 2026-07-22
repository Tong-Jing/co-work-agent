import { atom } from "jotai";

export type View = "chat" | "mcp-servers" | "skills" | "memory" | "permissions" | "workflows";

export const viewAtom = atom<View>("chat");
