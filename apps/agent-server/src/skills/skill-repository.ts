import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateSkillRequest, SkillEntry, UpdateSkillRequest } from "@local-agent/contracts";

interface CustomSkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  version: string;
  taskTypes: string;
  requiredTools: string;
  risk: SkillEntry["risk"];
}

export class SkillRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): SkillEntry[] {
    const rows = this.database
      .prepare(
        "SELECT id, name, description, instructions, created_at AS createdAt, version, task_types AS taskTypes, required_tools AS requiredTools, risk FROM custom_skills ORDER BY created_at",
      )
      .all() as unknown as CustomSkillRow[];
    return rows.map(toEntry);
  }

  add(input: CreateSkillRequest): SkillEntry {
    const entry = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      createdAt: new Date().toISOString(),
      version: input.version,
      taskTypes: input.taskTypes,
      requiredTools: input.requiredTools,
      risk: input.risk,
    };
    this.database
      .prepare(
        "INSERT INTO custom_skills (id, name, description, instructions, created_at, version, task_types, required_tools, risk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.id,
        entry.name,
        entry.description,
        entry.instructions,
        entry.createdAt,
        entry.version,
        JSON.stringify(entry.taskTypes),
        JSON.stringify(entry.requiredTools),
        entry.risk,
      );
    return { ...entry, source: "custom" };
  }

  remove(id: string): boolean {
    const result = this.database.prepare("DELETE FROM custom_skills WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  update(id: string, changes: UpdateSkillRequest): SkillEntry | null {
    const existing = this.database
      .prepare(
        "SELECT id, name, description, instructions, created_at AS createdAt, version, task_types AS taskTypes, required_tools AS requiredTools, risk FROM custom_skills WHERE id = ?",
      )
      .get(id) as unknown as CustomSkillRow | undefined;
    if (!existing) return null;

    const next = {
      name: changes.name ?? existing.name,
      description: changes.description ?? existing.description,
      instructions: changes.instructions ?? existing.instructions,
      version: changes.version ?? existing.version,
      taskTypes: changes.taskTypes ?? parseJsonArray(existing.taskTypes),
      requiredTools: changes.requiredTools ?? parseJsonArray(existing.requiredTools),
      risk: changes.risk ?? existing.risk,
    };

    this.database
      .prepare(
        "UPDATE custom_skills SET name = ?, description = ?, instructions = ?, version = ?, task_types = ?, required_tools = ?, risk = ? WHERE id = ?",
      )
      .run(
        next.name,
        next.description,
        next.instructions,
        next.version,
        JSON.stringify(next.taskTypes),
        JSON.stringify(next.requiredTools),
        next.risk,
        id,
      );

    return { id, createdAt: existing.createdAt, source: "custom", ...next };
  }
}

function toEntry(row: CustomSkillRow): SkillEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: row.createdAt,
    source: "custom",
    version: row.version,
    taskTypes: parseJsonArray(row.taskTypes),
    requiredTools: parseJsonArray(row.requiredTools),
    risk: row.risk,
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
