export const publicRunStages = [
  "preparing-context",
  "calling-model",
  "waiting-for-approval",
  "executing-tool",
  "completed",
] as const;

export type PublicRunStage = (typeof publicRunStages)[number];
