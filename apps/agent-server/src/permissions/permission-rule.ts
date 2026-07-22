import type { PermissionDecisionValue, PermissionMatcher } from "@local-agent/contracts";

export interface PermissionRule {
  id: string;
  workspaceId: string;
  toolName: string;
  matcher: PermissionMatcher;
  decision: PermissionDecisionValue;
  priority: number;
  enabled: boolean;
  source: "builtin" | "custom";
  createdAt: string;
}

/**
 * Ships with the app as sensible safety defaults; users can add custom rules and disable
 * (but not delete) these through the API/UI, mirroring the builtin MCP server override pattern.
 */
export const builtinPermissionRules: Array<Omit<PermissionRule, "workspaceId" | "createdAt" | "source">> = [
  {
    id: "deny-dotenv-and-git",
    toolName: "write_file",
    matcher: { kind: "path", pattern: "**/.env*" },
    decision: "deny",
    priority: 100,
    enabled: true,
  },
  {
    id: "deny-git-directory",
    toolName: "write_file",
    matcher: { kind: "path", pattern: ".git/**" },
    decision: "deny",
    priority: 100,
    enabled: true,
  },
  {
    id: "allow-tmp-writes",
    toolName: "write_file",
    matcher: { kind: "path", pattern: "tmp/**" },
    decision: "allow",
    priority: 10,
    enabled: true,
  },
  {
    id: "allow-docs-writes",
    toolName: "write_file",
    matcher: { kind: "path", pattern: "docs/**" },
    decision: "allow",
    priority: 10,
    enabled: true,
  },
  {
    id: "allow-safe-tasks",
    toolName: "run_task",
    matcher: { kind: "arg", field: "task", values: ["test", "typecheck"] },
    decision: "allow",
    priority: 10,
    enabled: true,
  },
  {
    id: "ask-build-task",
    toolName: "run_task",
    matcher: { kind: "arg", field: "task", values: ["build"] },
    decision: "ask",
    priority: 10,
    enabled: true,
  },
];
