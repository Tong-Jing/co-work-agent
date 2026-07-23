import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../context-builder.js";
import { SkillSelector } from "../../skills/skill-selector.js";
import { defaultAgentConfig } from "../agent-config.js";
import type { Skill } from "../../skills/skill.js";
import { ToolRegistry } from "../../tools/tool-registry.js";

function makeMemory(overrides: { memories?: Array<{ category: string; content: string }>; history?: Array<{ role: "user" | "assistant"; content: string }> } = {}) {
  return {
    longTerm: { recall: async () => overrides.memories ?? [] },
    conversation: { getMessages: () => overrides.history ?? [] },
  };
}

function makeSkills(skills: Skill[]) {
  return { list: () => skills };
}

describe("ContextBuilder", () => {
  it("builds a system message combining instructions, memories, and skills, then appends history", async () => {
    const memory = makeMemory({
      memories: [{ category: "fact", content: "user prefers TypeScript" }],
      history: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
    });
    const testingSkill: Skill = {
      id: "testing",
      name: "Testing",
      description: "write tests",
      instructions: "Always add tests for new code.",
      source: "bundled",
      version: "1.0.0",
      taskTypes: ["testing"],
      requiredTools: ["run_task"],
      risk: "low",
    };
    const skills = makeSkills([testingSkill]);
    const builder = new ContextBuilder(memory as any, skills as any, new SkillSelector(), new ToolRegistry());

    const { messages, allowedTools, gathered } = await builder.build(defaultAgentConfig, "session-1", "workspace-1", "write tests for this", "/workspace");

    expect(messages[0]!.role).toBe("system");
    const systemContent = messages[0]!.content as string;
    expect(systemContent).toContain(defaultAgentConfig.systemInstructions);
    expect(systemContent).toContain("/workspace");
    expect(systemContent).toContain("user prefers TypeScript");
    expect(systemContent).toContain("Always add tests for new code.");

    expect(messages.slice(1)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);

    expect(gathered).toEqual(expect.objectContaining({ memoryCount: 1, skillCount: 1, historyCount: 2, maxTokens: defaultAgentConfig.maxContextTokens, omittedMessages: 0 }));
    expect(allowedTools).toEqual(expect.arrayContaining(["run_task", "read_file", "list_files", "search_files"]));
  });

  it("omits memory and skills sections entirely when there is nothing relevant", async () => {
    const memory = makeMemory();
    const skills = makeSkills([]);
    const builder = new ContextBuilder(memory as any, skills as any, new SkillSelector(), new ToolRegistry());

    const { messages, allowedTools, gathered } = await builder.build(defaultAgentConfig, "session-1", "workspace-1", "just chatting", "/workspace");

    const systemContent = messages[0]!.content as string;
    expect(systemContent).not.toContain("Relevant long-term memory");
    expect(systemContent).not.toContain("Task skills");
    expect(gathered).toEqual(expect.objectContaining({ memoryCount: 0, skillCount: 0, historyCount: 0, maxTokens: defaultAgentConfig.maxContextTokens, omittedMessages: 0 }));
    expect(allowedTools).toBeNull();
  });
});
