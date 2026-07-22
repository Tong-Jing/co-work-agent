import type { FastifyInstance } from "fastify";
import type { ToolRegistry } from "../../tools/tool-registry.js";
import { z } from "zod";

export function registerToolInfoRoutes(app: FastifyInstance, tools: ToolRegistry) {
  app.get("/api/tools", async () => {
    return tools.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      inputFields: inputFieldNames(tool.inputSchema),
    }));
  });
}

function inputFieldNames(schema: z.ZodType): string[] {
  const jsonSchema = z.toJSONSchema(schema) as { properties?: Record<string, unknown> };
  return Object.keys(jsonSchema.properties ?? {});
}
