import type { AnyTool } from "../tools/tool.js";
import { matchesGlob } from "./glob-matcher.js";
import type { PermissionRule } from "./permission-rule.js";

export interface PermissionEvaluation {
  requiresApproval: boolean;
  decision: "allow" | "deny" | "ask";
  matchedRuleId: string | null;
}

export class PermissionPolicy {
  requiresApprovalLegacy(tool: AnyTool) {
    return tool.risk !== "low";
  }

  displayRisk(risk: AnyTool["risk"]): "medium" | "high" {
    return risk === "high" ? "high" : "medium";
  }

  /** Evaluates active rules (already filtered/sorted by priority desc) against a tool call; falls back to the tool's static risk when nothing matches. */
  evaluate(tool: AnyTool, input: unknown, rules: PermissionRule[]): PermissionEvaluation {
    for (const rule of rules) {
      if (!rule.enabled || rule.toolName !== tool.name) continue;
      if (this.matches(rule, input)) {
        return { requiresApproval: rule.decision === "ask", decision: rule.decision, matchedRuleId: rule.id };
      }
    }

    return { requiresApproval: tool.risk !== "low", decision: "ask", matchedRuleId: null };
  }

  private matches(rule: PermissionRule, input: unknown): boolean {
    if (rule.matcher.kind === "path") {
      const path = this.extractPath(input);
      return path !== null && matchesGlob(rule.matcher.pattern, path);
    }

    const value = this.extractField(input, rule.matcher.field);
    if (value === null) return false;
    return rule.matcher.values.includes(value);
  }

  private extractPath(input: unknown): string | null {
    if (typeof input === "object" && input !== null && "path" in input && typeof (input as { path: unknown }).path === "string") {
      return (input as { path: string }).path;
    }
    return null;
  }

  private extractField(input: unknown, field: string): string | null {
    if (typeof input !== "object" || input === null || !(field in input)) return null;
    const value = (input as Record<string, unknown>)[field];
    return typeof value === "string" ? value : null;
  }
}
