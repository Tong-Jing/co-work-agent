import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PermissionPolicy } from "../permission-policy.js";
import type { PermissionRule } from "../permission-rule.js";
import type { AnyTool, ToolRisk } from "../../tools/tool.js";

function makeTool(name: string, risk: ToolRisk): AnyTool {
  return {
    name,
    description: "test tool",
    inputSchema: z.object({}),
    risk,
    execute: async () => ({ content: "", summary: "" }),
  };
}

function makeRule(overrides: Partial<PermissionRule>): PermissionRule {
  return {
    id: overrides.id ?? "rule",
    workspaceId: "workspace-1",
    toolName: overrides.toolName ?? "write_file",
    matcher: overrides.matcher ?? { kind: "path", pattern: "tmp/**" },
    decision: overrides.decision ?? "allow",
    priority: overrides.priority ?? 0,
    enabled: overrides.enabled ?? true,
    source: overrides.source ?? "custom",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

describe("PermissionPolicy.evaluate", () => {
  it("falls back to the tool's static risk when no rule matches", () => {
    const policy = new PermissionPolicy();
    const lowRiskTool = makeTool("read_file", "low");
    const mediumRiskTool = makeTool("write_file", "medium");

    expect(policy.evaluate(lowRiskTool, {}, []).requiresApproval).toBe(false);
    expect(policy.evaluate(mediumRiskTool, { path: "src/index.ts" }, []).requiresApproval).toBe(true);
  });

  it("allows a write matching an allow-listed path rule without approval", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("write_file", "medium");
    const rules = [makeRule({ matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow" })];

    const result = policy.evaluate(tool, { path: "tmp/scratch.txt" }, rules);

    expect(result).toEqual({ requiresApproval: false, decision: "allow", matchedRuleId: "rule" });
  });

  it("denies a write matching a deny-listed path rule", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("write_file", "medium");
    const rules = [makeRule({ matcher: { kind: "path", pattern: "**/.env*" }, decision: "deny" })];

    const result = policy.evaluate(tool, { path: ".env" }, rules);

    expect(result.decision).toBe("deny");
    expect(result.requiresApproval).toBe(false);
  });

  it("does not match a path rule against an unrelated path", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("write_file", "medium");
    const rules = [makeRule({ matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow" })];

    const result = policy.evaluate(tool, { path: "src/index.ts" }, rules);

    expect(result.matchedRuleId).toBeNull();
    expect(result.requiresApproval).toBe(true); // falls back to static risk
  });

  it("matches an arg rule against a specific field value", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("run_task", "medium");
    const rules = [makeRule({ toolName: "run_task", matcher: { kind: "arg", field: "task", values: ["test", "typecheck"] }, decision: "allow" })];

    expect(policy.evaluate(tool, { task: "test" }, rules).decision).toBe("allow");
    expect(policy.evaluate(tool, { task: "build" }, rules).matchedRuleId).toBeNull();
  });

  it("respects rule priority ordering, applying the highest-priority match first", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("write_file", "medium");
    const rules = [
      makeRule({ id: "low-priority-allow", matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow", priority: 1 }),
      makeRule({ id: "high-priority-deny", matcher: { kind: "path", pattern: "tmp/**" }, decision: "deny", priority: 100 }),
    ];

    // caller is expected to pre-sort by priority desc, matching PermissionService's contract
    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    const result = policy.evaluate(tool, { path: "tmp/scratch.txt" }, sorted);

    expect(result.matchedRuleId).toBe("high-priority-deny");
    expect(result.decision).toBe("deny");
  });

  it("skips disabled rules", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("write_file", "medium");
    const rules = [makeRule({ matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow", enabled: false })];

    const result = policy.evaluate(tool, { path: "tmp/scratch.txt" }, rules);

    expect(result.matchedRuleId).toBeNull();
    expect(result.requiresApproval).toBe(true);
  });

  it("ignores rules for other tools", () => {
    const policy = new PermissionPolicy();
    const tool = makeTool("write_file", "medium");
    const rules = [makeRule({ toolName: "run_task", matcher: { kind: "path", pattern: "tmp/**" }, decision: "allow" })];

    const result = policy.evaluate(tool, { path: "tmp/scratch.txt" }, rules);

    expect(result.matchedRuleId).toBeNull();
  });

  it("maps risk levels to display risk", () => {
    const policy = new PermissionPolicy();
    expect(policy.displayRisk("high")).toBe("high");
    expect(policy.displayRisk("medium")).toBe("medium");
    expect(policy.displayRisk("low")).toBe("medium");
  });
});
