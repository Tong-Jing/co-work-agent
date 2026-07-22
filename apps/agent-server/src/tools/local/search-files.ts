import { execa } from "execa";
import { z } from "zod";
import type { PathPolicy } from "../../workspace/path-policy.js";
import type { Tool } from "../tool.js";

const inputSchema = z.object({
  query: z.string().min(1).max(500),
  path: z.string().default("."),
});

export function createSearchFilesTool(paths: PathPolicy): Tool<z.infer<typeof inputSchema>> {
  return {
    name: "search_files",
    description: "Search text in workspace files using a literal, case-insensitive query.",
    inputSchema,
    risk: "low",
    async execute(input, context) {
      const result = await execa(
        "git",
        ["grep", "-n", "-i", "-F", "--", input.query, input.path],
        { cwd: paths.workspaceRoot, reject: false, cancelSignal: context.signal },
      );
      const output = result.stdout.split(/\r?\n/).slice(0, 300).join("\n");
      return { content: output || "No matches found", summary: output ? "Search completed with matches" : "No matches found" };
    },
  };
}
