import type { Skill } from "./skill.js";

export class SkillRegistry {
  readonly #skills = new Map<string, Skill>();

  register(skill: Skill) {
    this.#skills.set(skill.id, skill);
  }

  remove(id: string) {
    this.#skills.delete(id);
  }

  list() {
    return [...this.#skills.values()];
  }
}
