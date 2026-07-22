import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "../skill-loader.js";

async function makeSkillDirectory(name: string, content: string) {
  const root = await mkdtemp(path.join(tmpdir(), "skills-"));
  const skillDir = path.join(root, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), content, "utf8");
  return root;
}

describe("SkillLoader", () => {
  let tempDir: string | null = null;
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it("parses YAML frontmatter into structured skill metadata", async () => {
    tempDir = await makeSkillDirectory(
      "code-review",
      `---
name: Code Review
description: Review code changes for correctness and security.
version: 2.1.0
taskTypes: [code-review, security]
requiredTools: [read_file, git_diff]
risk: medium
---

Read the diff before reporting findings.
`,
    );

    const skills = await new SkillLoader().loadDirectory(tempDir, "bundled");

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "code-review",
      name: "Code Review",
      description: "Review code changes for correctness and security.",
      version: "2.1.0",
      taskTypes: ["code-review", "security"],
      requiredTools: ["read_file", "git_diff"],
      risk: "medium",
      instructions: "Read the diff before reporting findings.",
      source: "bundled",
    });
  });

  it("applies defaults when optional frontmatter fields are omitted", async () => {
    tempDir = await makeSkillDirectory(
      "minimal",
      `---
name: Minimal Skill
---

Just do the thing.
`,
    );

    const skills = await new SkillLoader().loadDirectory(tempDir, "custom");

    expect(skills[0]).toMatchObject({
      name: "Minimal Skill",
      description: "",
      version: "1.0.0",
      taskTypes: [],
      requiredTools: [],
      risk: "low",
    });
  });

  it("skips skill files missing frontmatter or a required name field, without throwing", async () => {
    tempDir = await makeSkillDirectory("broken", "# Just a heading\nNo frontmatter here.\n");

    const skills = await new SkillLoader().loadDirectory(tempDir, "bundled");

    expect(skills).toEqual([]);
  });
});
