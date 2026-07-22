import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PathPolicy } from "../../workspace/path-policy.js";
import type { Tool } from "../tool.js";

const inputSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(1_000_000),
});

export function createWriteFileTool(): Tool<z.infer<typeof inputSchema>> {
  return {
    name: "write_file",
    description: "Create or replace one UTF-8 file in the workspace. Requires user approval.",
    inputSchema,
    risk: "medium",
    async execute(input, context) {
      const paths = new PathPolicy(context.workspaceRoot);
      const target = paths.resolve(input.path);
      const previous = await readFile(target, "utf8").catch(() => "");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, "utf8");
      return {
        content: `Wrote ${input.content.length} characters to ${input.path}`,
        summary: `Updated ${input.path}`,
        metadata: { path: input.path, previousLength: previous.length, nextLength: input.content.length },
      };
    },
  };
}
