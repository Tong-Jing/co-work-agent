import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreatePermissionRuleRequest, PermissionMatcher } from "@local-agent/contracts";
import type { PermissionRule } from "./permission-rule.js";

interface PermissionRuleRow {
  id: string;
  workspaceId: string;
  toolName: string;
  matcherKind: "path" | "arg";
  matcherPattern: string | null;
  matcherField: string | null;
  matcherValues: string | null;
  decision: PermissionRule["decision"];
  priority: number;
  enabled: number;
  createdAt: string;
}

export class PermissionRuleRepository {
  constructor(private readonly database: DatabaseSync) {}

  listForWorkspace(workspaceId: string): PermissionRule[] {
    const rows = this.database
      .prepare(
        `SELECT id, workspace_id AS workspaceId, tool_name AS toolName, matcher_kind AS matcherKind,
                matcher_pattern AS matcherPattern, matcher_field AS matcherField, matcher_values AS matcherValues,
                decision, priority, enabled, created_at AS createdAt
         FROM permission_rules WHERE workspace_id = ? ORDER BY priority DESC, created_at ASC`,
      )
      .all(workspaceId) as unknown as PermissionRuleRow[];
    return rows.map(toRule);
  }

  add(input: CreatePermissionRuleRequest): PermissionRule {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.insert(id, input, createdAt);
    return {
      id,
      workspaceId: input.workspaceId,
      toolName: input.toolName,
      matcher: input.matcher,
      decision: input.decision,
      priority: input.priority,
      enabled: input.enabled,
      source: "custom",
      createdAt,
    };
  }

  update(id: string, changes: { enabled?: boolean; priority?: number; decision?: PermissionRule["decision"] }): boolean {
    const existing = this.database.prepare("SELECT id FROM permission_rules WHERE id = ?").get(id);
    if (!existing) return false;

    if (changes.enabled !== undefined) {
      this.database.prepare("UPDATE permission_rules SET enabled = ? WHERE id = ?").run(changes.enabled ? 1 : 0, id);
    }
    if (changes.priority !== undefined) {
      this.database.prepare("UPDATE permission_rules SET priority = ? WHERE id = ?").run(changes.priority, id);
    }
    if (changes.decision !== undefined) {
      this.database.prepare("UPDATE permission_rules SET decision = ? WHERE id = ?").run(changes.decision, id);
    }
    return true;
  }

  remove(id: string): boolean {
    const result = this.database.prepare("DELETE FROM permission_rules WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  private insert(id: string, input: CreatePermissionRuleRequest, createdAt: string) {
    this.database
      .prepare(
        `INSERT INTO permission_rules
          (id, workspace_id, tool_name, matcher_kind, matcher_pattern, matcher_field, matcher_values, decision, priority, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.toolName,
        input.matcher.kind,
        input.matcher.kind === "path" ? input.matcher.pattern : null,
        input.matcher.kind === "arg" ? input.matcher.field : null,
        input.matcher.kind === "arg" ? JSON.stringify(input.matcher.values) : null,
        input.decision,
        input.priority,
        input.enabled ? 1 : 0,
        createdAt,
      );
  }
}

function toRule(row: PermissionRuleRow): PermissionRule {
  const matcher: PermissionMatcher =
    row.matcherKind === "path"
      ? { kind: "path", pattern: row.matcherPattern ?? "" }
      : { kind: "arg", field: row.matcherField ?? "", values: row.matcherValues ? (JSON.parse(row.matcherValues) as string[]) : [] };

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    toolName: row.toolName,
    matcher,
    decision: row.decision,
    priority: row.priority,
    enabled: Boolean(row.enabled),
    source: "custom",
    createdAt: row.createdAt,
  };
}
