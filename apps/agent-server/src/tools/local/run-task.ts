import { execa } from "execa";
import { z } from "zod";
import { workspaceTasks } from "../../workspace/task-config.js";
import type { Tool } from "../tool.js";

const inputSchema = z.object({ task: z.enum(["test", "typecheck", "build"]) });

export function createRunTaskTool(): Tool<z.infer<typeof inputSchema>> {
  return {
    name: "run_task",
    description: "Run one predefined npm task in the workspace. Requires user approval.",
    inputSchema,
    risk: "medium",
    async execute(input, context) {
      const task = workspaceTasks[input.task];
      const result = await execa(task.command, task.args, {
        cwd: context.workspaceRoot,
        cancelSignal: context.signal,
        reject: false,
      });
      const content = `${result.stdout}\n${result.stderr}`.trim().slice(-100_000);
      return {
        content: content || `Task exited with code ${result.exitCode}`,
        summary: `${input.task} exited with code ${result.exitCode}`,
      };
    },
  };
}
