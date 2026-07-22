import { describe, expect, it } from "vitest";
import { SkillSelector } from "../skill-selector.js";
import type { Skill } from "../skill.js";

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    id: overrides.id ?? "id",
    name: overrides.name ?? "name",
    description: overrides.description ?? "description",
    instructions: overrides.instructions ?? "instructions",
    source: overrides.source ?? "bundled",
    version: overrides.version ?? "1.0.0",
    taskTypes: overrides.taskTypes ?? [],
    requiredTools: overrides.requiredTools ?? [],
    risk: overrides.risk ?? "low",
  };
}

describe("SkillSelector", () => {
  it("selects skills whose name or description matches prompt terms", () => {
    const selector = new SkillSelector();
    const codeReview = makeSkill({ id: "code-review", name: "Code Review", description: "review pull requests" });
    const testing = makeSkill({ id: "testing", name: "Testing", description: "write and run tests" });
    const unrelated = makeSkill({ id: "unrelated", name: "Deployment", description: "deploy infrastructure" });

    const selected = selector.select("please review this pull request", [codeReview, testing, unrelated]);

    expect(selected.map((skill) => skill.id)).toEqual(["code-review"]);
  });

  it("returns no more than the configured limit, ranked by match score", () => {
    const selector = new SkillSelector();
    const skills = [
      makeSkill({ id: "a", name: "alpha", description: "test test test" }),
      makeSkill({ id: "b", name: "beta", description: "test test" }),
      makeSkill({ id: "c", name: "gamma", description: "test" }),
    ];

    const selected = selector.select("test test test", skills, 2);

    expect(selected).toHaveLength(2);
    expect(selected.map((skill) => skill.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array when nothing matches", () => {
    const selector = new SkillSelector();
    const selected = selector.select("unrelated prompt", [makeSkill({ id: "x", name: "xyz", description: "abc" })]);
    expect(selected).toEqual([]);
  });

  it("matches on taskTypes as well as name/description", () => {
    const selector = new SkillSelector();
    const security = makeSkill({ id: "security", name: "Audit", description: "look for issues", taskTypes: ["security"] });
    const selected = selector.select("please do a security check", [security]);
    expect(selected.map((skill) => skill.id)).toEqual(["security"]);
  });
});
