import { describe, expect, it } from "vitest";
import { PermissionService } from "../permission-service.js";
import { PermissionPolicy } from "../permission-policy.js";
import { builtinPermissionRules } from "../permission-rule.js";

function makeRepos(overrideEnabled: boolean | null = null) {
  const customRules = { listForWorkspace: () => [] } as any;
  const builtinOverrides = { getEnabledOverride: () => overrideEnabled } as any;
  return { customRules, builtinOverrides };
}

describe("PermissionService.rulesForWorkspace", () => {
  it("includes all builtin rules with their default enabled state when there is no override", () => {
    const { customRules, builtinOverrides } = makeRepos(null);
    const service = new PermissionService(new PermissionPolicy(), customRules, builtinOverrides);

    const rules = service.rulesForWorkspace("workspace-1");

    expect(rules.length).toBe(builtinPermissionRules.length);
    expect(rules.every((rule) => rule.source === "builtin")).toBe(true);
    expect(rules.every((rule) => rule.enabled === true)).toBe(true);
  });

  it("applies a builtin override to disable a shipped default rule", () => {
    const { customRules, builtinOverrides } = makeRepos(false);
    const service = new PermissionService(new PermissionPolicy(), customRules, builtinOverrides);

    const rules = service.rulesForWorkspace("workspace-1");

    expect(rules.every((rule) => rule.enabled === false)).toBe(true);
  });

  it("merges custom rules alongside builtin ones, sorted by priority", () => {
    const customRules = {
      listForWorkspace: () => [
        {
          id: "custom-1",
          workspaceId: "workspace-1",
          toolName: "write_file",
          matcher: { kind: "path" as const, pattern: "src/generated/**" },
          decision: "allow" as const,
          priority: 999,
          enabled: true,
          source: "custom" as const,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const builtinOverrides = { getEnabledOverride: () => null } as any;
    const service = new PermissionService(new PermissionPolicy(), customRules as any, builtinOverrides);

    const rules = service.rulesForWorkspace("workspace-1");

    expect(rules[0]!.id).toBe("custom-1");
    expect(rules.length).toBe(builtinPermissionRules.length + 1);
  });

  it("evaluate() uses the merged rule set to make a decision", () => {
    const { customRules, builtinOverrides } = makeRepos(null);
    const service = new PermissionService(new PermissionPolicy(), customRules, builtinOverrides);

    const tool = { name: "write_file", description: "", inputSchema: {} as any, risk: "medium" as const, execute: async () => ({ content: "", summary: "" }) };
    const result = service.evaluate(tool, { path: ".env" }, "workspace-1");

    expect(result.decision).toBe("deny");
  });
});
