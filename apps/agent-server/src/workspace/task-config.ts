export const workspaceTasks = {
  test: { command: "npm", args: ["test"] },
  typecheck: { command: "npm", args: ["run", "typecheck"] },
  build: { command: "npm", args: ["run", "build"] },
} as const;

export type WorkspaceTaskName = keyof typeof workspaceTasks;
