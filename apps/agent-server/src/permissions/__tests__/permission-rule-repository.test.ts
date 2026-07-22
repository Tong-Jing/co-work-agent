import { describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { PermissionRuleRepository } from "../permission-rule-repository.js";

function setup() {
  const database = createDatabase(":memory:");
  const workspaceId = (database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string }).id;
  return { repository: new PermissionRuleRepository(database), workspaceId };
}

describe("PermissionRuleRepository", () => {
  it("stores and lists path-matcher rules for a workspace", () => {
    const { repository, workspaceId } = setup();

    repository.add({
      workspaceId,
      toolName: "write_file",
      matcher: { kind: "path", pattern: "tmp/**" },
      decision: "allow",
      priority: 5,
      enabled: true,
    });

    const rules = repository.listForWorkspace(workspaceId);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      toolName: "write_file",
      matcher: { kind: "path", pattern: "tmp/**" },
      decision: "allow",
      priority: 5,
      enabled: true,
      source: "custom",
    });
  });

  it("stores and lists arg-matcher rules with their values array intact", () => {
    const { repository, workspaceId } = setup();

    repository.add({
      workspaceId,
      toolName: "run_task",
      matcher: { kind: "arg", field: "task", values: ["test", "typecheck"] },
      decision: "allow",
      priority: 0,
      enabled: true,
    });

    const [rule] = repository.listForWorkspace(workspaceId);
    expect(rule!.matcher).toEqual({ kind: "arg", field: "task", values: ["test", "typecheck"] });
  });

  it("orders rules by priority descending, then by creation order", () => {
    const { repository, workspaceId } = setup();
    repository.add({ workspaceId, toolName: "write_file", matcher: { kind: "path", pattern: "a/**" }, decision: "allow", priority: 1, enabled: true });
    repository.add({ workspaceId, toolName: "write_file", matcher: { kind: "path", pattern: "b/**" }, decision: "allow", priority: 100, enabled: true });

    const rules = repository.listForWorkspace(workspaceId);
    expect(rules.map((rule) => (rule.matcher as { pattern: string }).pattern)).toEqual(["b/**", "a/**"]);
  });

  it("isolates rules per workspace", () => {
    const { repository, workspaceId } = setup();
    const otherWorkspaceId = "other-workspace";
    repository.add({ workspaceId, toolName: "write_file", matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow", priority: 0, enabled: true });

    expect(repository.listForWorkspace(otherWorkspaceId)).toEqual([]);
  });

  it("updates enabled/priority/decision independently", () => {
    const { repository, workspaceId } = setup();
    const rule = repository.add({ workspaceId, toolName: "write_file", matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow", priority: 0, enabled: true });

    expect(repository.update(rule.id, { enabled: false })).toBe(true);
    expect(repository.listForWorkspace(workspaceId)[0]!.enabled).toBe(false);

    expect(repository.update(rule.id, { priority: 42 })).toBe(true);
    expect(repository.listForWorkspace(workspaceId)[0]!.priority).toBe(42);

    expect(repository.update("nonexistent", { enabled: true })).toBe(false);
  });

  it("removes a rule", () => {
    const { repository, workspaceId } = setup();
    const rule = repository.add({ workspaceId, toolName: "write_file", matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow", priority: 0, enabled: true });

    expect(repository.remove(rule.id)).toBe(true);
    expect(repository.listForWorkspace(workspaceId)).toEqual([]);
    expect(repository.remove(rule.id)).toBe(false);
  });
});
