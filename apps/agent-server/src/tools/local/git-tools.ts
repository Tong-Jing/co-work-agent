import { execa } from "execa";
import { z } from "zod";
import type { AnyTool, Tool } from "../tool.js";

const noInputSchema = z.object({});
const commitSchema = z.object({ message: z.string().trim().min(1).max(200), files: z.array(z.string().min(1)).min(1) });

export function createGitTools(): AnyTool[] {
  const gitCommitTool: Tool<z.infer<typeof commitSchema>> = {
    name: "git_commit",
    description: "Stage an explicit file list and create a local Git commit. Requires user approval.",
    inputSchema: commitSchema,
    risk: "high",
    async execute(input, context) {
      await execa("git", ["add", "--", ...input.files], { cwd: context.workspaceRoot, cancelSignal: context.signal });
      const result = await execa("git", ["commit", "-m", input.message], { cwd: context.workspaceRoot, cancelSignal: context.signal });
      return { content: result.stdout, summary: `Created local commit: ${input.message}` };
    },
  };

  return [
    {
      name: "git_status",
      description: "Show the current workspace Git status.",
      inputSchema: noInputSchema,
      risk: "low",
      async execute(_input, context) {
        const result = await execa("git", ["status", "--short", "--branch"], { cwd: context.workspaceRoot, cancelSignal: context.signal });
        return { content: result.stdout || "Working tree clean", summary: "Read Git status" };
      },
    },
    {
      name: "git_diff",
      description: "Show unstaged and staged changes in the current workspace.",
      inputSchema: noInputSchema,
      risk: "low",
      async execute(_input, context) {
        const [unstaged, staged] = await Promise.all([
          execa("git", ["diff", "--"], { cwd: context.workspaceRoot, cancelSignal: context.signal }),
          execa("git", ["diff", "--cached", "--"], { cwd: context.workspaceRoot, cancelSignal: context.signal }),
        ]);
        const content = `Unstaged:\n${unstaged.stdout}\n\nStaged:\n${staged.stdout}`.slice(0, 100_000);
        return { content, summary: "Read Git diff" };
      },
    },
    gitCommitTool,
  ];
}
