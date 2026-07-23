import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PathPolicy } from "../../workspace/path-policy.js";
import type { Tool } from "../tool.js";

const inputSchema = z.object({
  path: z.string().default("."),
  depth: z.number().int().min(1).max(4).default(2),
});

export function createListFilesTool(): Tool<z.infer<typeof inputSchema>> {
  return {
    name: "list_files",
    description: "List files and directories inside the current workspace.",
    inputSchema,
    risk: "low",
    idempotent: true,
    async execute(input, context) {
      const paths = new PathPolicy(context.workspaceRoot);
      const root = paths.resolve(input.path);
      const files: string[] = [];

      async function walk(directory: string, depth: number) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if ([".co-work", ".git", "node_modules", "dist"].includes(entry.name)) continue;
          const absolute = path.join(directory, entry.name);
          files.push(path.relative(paths.workspaceRoot, absolute).replaceAll("\\", "/"));
          if (entry.isDirectory() && depth > 1) await walk(absolute, depth - 1);
          if (files.length >= 500) return;
        }
      }

      await walk(root, input.depth);
      return { content: files.join("\n"), summary: `Listed ${files.length} workspace entries` };
    },
  };
}
