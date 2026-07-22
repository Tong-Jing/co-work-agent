import { describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { SkillRepository } from "../skill-repository.js";

function setup() {
  const database = createDatabase(":memory:");
  return new SkillRepository(database);
}

describe("SkillRepository", () => {
  it("creates and lists a custom skill with structured metadata", () => {
    const repository = setup();
    repository.add({
      name: "API Review",
      description: "check API design",
      instructions: "Look for breaking changes.",
      version: "1.0.0",
      taskTypes: ["api-review"],
      requiredTools: ["read_file", "search_files"],
      risk: "medium",
    });

    const [skill] = repository.list();
    expect(skill).toMatchObject({
      name: "API Review",
      taskTypes: ["api-review"],
      requiredTools: ["read_file", "search_files"],
      risk: "medium",
      source: "custom",
    });
  });

  it("updates only the provided fields, leaving the rest untouched", () => {
    const repository = setup();
    const created = repository.add({
      name: "API Review",
      description: "check API design",
      instructions: "Look for breaking changes.",
      version: "1.0.0",
      taskTypes: ["api-review"],
      requiredTools: ["read_file"],
      risk: "low",
    });

    const updated = repository.update(created.id, { risk: "high", requiredTools: ["read_file", "write_file"] });

    expect(updated).toMatchObject({
      name: "API Review",
      description: "check API design",
      risk: "high",
      requiredTools: ["read_file", "write_file"],
      taskTypes: ["api-review"],
    });
  });

  it("returns null when updating a nonexistent skill", () => {
    const repository = setup();
    expect(repository.update("nonexistent", { risk: "high" })).toBeNull();
  });
});
