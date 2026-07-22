import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../skill-registry.js";
import type { Skill } from "../skill.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "API Review",
    description: "check API design",
    instructions: "Look for breaking changes.",
    source: "custom",
    version: "1.0.0",
    taskTypes: [],
    requiredTools: [],
    risk: "low",
    ...overrides,
  };
}

describe("SkillRegistry", () => {
  it("overwrites rather than duplicates when the same id is registered again", () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill({ risk: "low" }));
    registry.register(makeSkill({ risk: "high" }));

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({ risk: "high" });
  });

  it("removes a skill so it no longer appears in list()", () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill());
    registry.remove("skill-1");

    expect(registry.list()).toHaveLength(0);
  });

  it("removing a nonexistent id is a no-op", () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill());
    registry.remove("nonexistent");

    expect(registry.list()).toHaveLength(1);
  });
});
