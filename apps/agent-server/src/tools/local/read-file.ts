import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PathPolicy } from "../../workspace/path-policy.js";
import type { Tool } from "../tool.js";

const inputSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().default(1),
  maxLines: z.number().int().positive().max(1000).default(300),
});

export function createReadFileTool(): Tool<z.infer<typeof inputSchema>> {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace with line limits.",
    inputSchema,
    risk: "low",
    async execute(input, context) {
      const paths = new PathPolicy(context.workspaceRoot);
      const content = await readFile(paths.resolve(input.path), "utf8");
      const lines = content.split(/\r?\n/).slice(input.startLine - 1, input.startLine - 1 + input.maxLines);
      const numbered = lines.map((line, index) => `${input.startLine + index}\t${line}`).join("\n");
      return { content: numbered, summary: `Read ${lines.length} lines from ${input.path}` };
    },
  };
}
