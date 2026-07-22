import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Skill } from "./skill.js";
import { skillFrontmatterSchema } from "./skill-frontmatter.js";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export class SkillLoader {
  async loadDirectory(directory: string, source: Skill["source"]): Promise<Skill[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(directory, entry.name, "SKILL.md");
      const raw = await readFile(filePath, "utf8").catch(() => null);
      if (!raw) continue;

      try {
        skills.push(this.parseSkillFile(entry.name, raw, source));
      } catch (error) {
        console.warn(`[skill-loader] skipping invalid skill file ${filePath}: ${error instanceof Error ? error.message : error}`);
      }
    }

    return skills;
  }

  private parseSkillFile(id: string, raw: string, source: Skill["source"]): Skill {
    const match = raw.match(FRONTMATTER_PATTERN);
    if (!match) {
      throw new Error("Missing YAML frontmatter (expected a leading `---` block with name/description/etc.)");
    }

    const [, frontmatterBlock, body] = match;
    const parsedYaml: unknown = parseYaml(frontmatterBlock ?? "");
    const frontmatter = skillFrontmatterSchema.parse(parsedYaml ?? {});

    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      instructions: (body ?? "").trim(),
      source,
      version: frontmatter.version,
      taskTypes: frontmatter.taskTypes,
      requiredTools: frontmatter.requiredTools,
      risk: frontmatter.risk,
    };
  }
}
