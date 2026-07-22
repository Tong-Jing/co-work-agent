import { z } from "zod";
import type { LlmToolDefinition } from "../llm/llm-types.js";
import type { AnyTool } from "./tool.js";

export class ToolRegistry {
  readonly #tools = new Map<string, AnyTool>();

  register(tool: AnyTool) {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.#tools.set(tool.name, tool);
  }

  registerAll(tools: AnyTool[]) {
    for (const tool of tools) this.register(tool);
  }

  get(name: string) {
    return this.#tools.get(name);
  }

  has(name: string) {
    return this.#tools.has(name);
  }

  list(): AnyTool[] {
    return [...this.#tools.values()];
  }

  definitions(allowList?: string[] | null): LlmToolDefinition[] {
    const tools = allowList
      ? [...this.#tools.values()].filter((tool) => allowList.includes(tool.name))
      : [...this.#tools.values()];
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
      },
    }));
  }
}
