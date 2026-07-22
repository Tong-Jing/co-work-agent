import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tool-registry.js";
import type { AnyTool } from "../tool.js";

function makeTool(name: string): AnyTool {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: z.object({}),
    risk: "low",
    execute: async () => ({ content: "", summary: "" }),
  };
}

describe("ToolRegistry.definitions", () => {
  it("returns all tool definitions when no allow list is given", () => {
    const registry = new ToolRegistry();
    registry.registerAll([makeTool("a"), makeTool("b")]);

    expect(registry.definitions().map((d) => d.function.name)).toEqual(["a", "b"]);
    expect(registry.definitions(null).map((d) => d.function.name)).toEqual(["a", "b"]);
  });

  it("filters definitions down to the allow list", () => {
    const registry = new ToolRegistry();
    registry.registerAll([makeTool("a"), makeTool("b"), makeTool("c")]);

    expect(registry.definitions(["b"]).map((d) => d.function.name)).toEqual(["b"]);
  });

  it("returns an empty list when the allow list matches nothing", () => {
    const registry = new ToolRegistry();
    registry.registerAll([makeTool("a")]);

    expect(registry.definitions(["nonexistent"])).toEqual([]);
  });
});
