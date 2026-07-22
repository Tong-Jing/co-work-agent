import type { Skill } from "./skill.js";

export class SkillSelector {
  select(prompt: string, skills: Skill[], limit = 2) {
    const terms = new Set(prompt.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 2));
    return skills
      .map((skill) => ({
        skill,
        score: [...terms].filter((term) =>
          `${skill.name} ${skill.description} ${skill.taskTypes.join(" ")}`.toLowerCase().includes(term),
        ).length,
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ skill }) => skill);
  }
}
