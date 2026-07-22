import type { AnyTool } from "../tools/tool.js";
import { builtinPermissionRules } from "./permission-rule.js";
import type { PermissionRule } from "./permission-rule.js";
import type { PermissionRuleRepository } from "./permission-rule-repository.js";
import type { BuiltinPermissionRuleOverrideRepository } from "./builtin-permission-rule-override-repository.js";
import type { PermissionEvaluation } from "./permission-policy.js";
import { PermissionPolicy } from "./permission-policy.js";

export class PermissionService {
  constructor(
    private readonly policy: PermissionPolicy,
    private readonly customRules: PermissionRuleRepository,
    private readonly builtinOverrides: BuiltinPermissionRuleOverrideRepository,
  ) {}

  evaluate(tool: AnyTool, input: unknown, workspaceId: string): PermissionEvaluation {
    const rules = this.rulesForWorkspace(workspaceId);
    return this.policy.evaluate(tool, input, rules);
  }

  displayRisk(risk: AnyTool["risk"]) {
    return this.policy.displayRisk(risk);
  }

  rulesForWorkspace(workspaceId: string): PermissionRule[] {
    const builtin: PermissionRule[] = builtinPermissionRules.map((rule) => {
      const override = this.builtinOverrides.getEnabledOverride(rule.id);
      return {
        ...rule,
        workspaceId,
        source: "builtin" as const,
        createdAt: "",
        enabled: override === null ? rule.enabled : override,
      };
    });
    const custom = this.customRules.listForWorkspace(workspaceId);
    return [...builtin, ...custom].sort((a, b) => b.priority - a.priority);
  }
}
