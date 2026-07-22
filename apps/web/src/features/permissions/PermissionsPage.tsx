import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { PermissionMatcher, PermissionRuleEntry } from "@local-agent/contracts";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import {
  createPermissionRule,
  deletePermissionRule,
  listPermissionRules,
  listTools,
  updatePermissionRule,
} from "../../api/client";
import { AppShell } from "../shell/AppShell";

function decisionLabel(decision: PermissionRuleEntry["decision"]) {
  if (decision === "allow") return "允许";
  if (decision === "deny") return "拒绝";
  return "需要审批";
}

function decisionClass(decision: PermissionRuleEntry["decision"]) {
  if (decision === "allow") return "status-on";
  if (decision === "deny") return "status-deny";
  return "status-off";
}

function matcherSummary(matcher: PermissionMatcher) {
  return matcher.kind === "path"
    ? `路径匹配 ${matcher.pattern}`
    : `${matcher.field} ∈ {${matcher.values.join(", ")}}`;
}

export function PermissionsPage() {
  const queryClient = useQueryClient();
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);

  const rules = useQuery({
    queryKey: ["permission-rules", workspaceId],
    queryFn: () => listPermissionRules(workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const tools = useQuery({ queryKey: ["tools"], queryFn: listTools });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updatePermissionRule(id, { enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["permission-rules", workspaceId] });
    },
    onError: (error) => console.error("[permission-rules] toggle failed", error),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePermissionRule,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["permission-rules", workspaceId] });
    },
    onError: (error) => console.error("[permission-rules] delete failed", error),
  });

  const builtinRules = rules.data?.filter((rule) => rule.source === "builtin") ?? [];
  const customRules = rules.data?.filter((rule) => rule.source === "custom") ?? [];

  return (
    <AppShell>
      <section className="settings-page">
        <header className="settings-header">
          <h1>Permissions</h1>
          <p className="muted">
            管理 Agent 执行工具时的自动放行/拒绝规则。规则按优先级从高到低匹配，命中即生效；未命中任何规则时回退到工具的默认风险等级判断。
          </p>
        </header>

        {!workspaceId && <p className="muted">请先在左侧选择一个 workspace。</p>}

        {workspaceId && (
          <>
            <h2 className="settings-subheading">内置默认规则</h2>
            <div className="card-list">
              {builtinRules.map((rule) => (
                <article className="card" key={rule.id}>
                  <div className="card-title">
                    <span className={`badge ${decisionClass(rule.decision)}`}>{decisionLabel(rule.decision)}</span>
                    <strong>{rule.toolName}</strong>
                    <span className="badge">内置</span>
                    <span className="muted">优先级 {rule.priority}</span>
                  </div>
                  <p className="muted">{matcherSummary(rule.matcher)}</p>
                  <div className="card-actions">
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={toggleMutation.isPending}
                        onChange={(event) => toggleMutation.mutate({ id: rule.id, enabled: event.target.checked })}
                      />
                      <span className={rule.enabled ? "status-on" : "status-off"}>{rule.enabled ? "已启用" : "已禁用"}</span>
                    </label>
                  </div>
                </article>
              ))}
              {builtinRules.length === 0 && <p className="muted">暂无内置规则。</p>}
            </div>

            <h2 className="settings-subheading">自定义规则</h2>
            <div className="card-list">
              {customRules.map((rule) => (
                <article className="card" key={rule.id}>
                  <div className="card-title">
                    <span className={`badge ${decisionClass(rule.decision)}`}>{decisionLabel(rule.decision)}</span>
                    <strong>{rule.toolName}</strong>
                    <span className="badge badge-custom">自定义</span>
                    <span className="muted">优先级 {rule.priority}</span>
                  </div>
                  <p className="muted">{matcherSummary(rule.matcher)}</p>
                  <div className="card-actions">
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={toggleMutation.isPending}
                        onChange={(event) => toggleMutation.mutate({ id: rule.id, enabled: event.target.checked })}
                      />
                      <span className={rule.enabled ? "status-on" : "status-off"}>{rule.enabled ? "已启用" : "已禁用"}</span>
                    </label>
                    <button
                      className="secondary"
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(rule.id)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
              {customRules.length === 0 && <p className="muted">还没有自定义规则。</p>}
            </div>

            <CreateRuleForm
              workspaceId={workspaceId}
              toolNames={tools.data?.map((tool) => tool.name) ?? []}
              toolFields={tools.data ?? []}
              queryClient={queryClient}
            />
          </>
        )}
      </section>
    </AppShell>
  );
}

interface CreateRuleFormProps {
  workspaceId: string;
  toolNames: string[];
  toolFields: Array<{ name: string; inputFields: string[] }>;
  queryClient: ReturnType<typeof useQueryClient>;
}

function CreateRuleForm({ workspaceId, toolNames, toolFields, queryClient }: CreateRuleFormProps) {
  const [toolName, setToolName] = useState("");
  const [matcherKind, setMatcherKind] = useState<"path" | "arg">("path");
  const [pattern, setPattern] = useState("");
  const [field, setField] = useState("");
  const [values, setValues] = useState("");
  const [decision, setDecision] = useState<"allow" | "deny" | "ask">("ask");
  const [priority, setPriority] = useState(10);

  const createMutation = useMutation({
    mutationFn: createPermissionRule,
    onSuccess: async () => {
      setPattern("");
      setField("");
      setValues("");
      setPriority(10);
      await queryClient.invalidateQueries({ queryKey: ["permission-rules", workspaceId] });
    },
    onError: (error) => console.error("[permission-rules] create failed", error),
  });

  const submitError = createMutation.isError
    ? createMutation.error instanceof Error ? createMutation.error.message : "创建失败"
    : null;

  const availableFields = toolFields.find((tool) => tool.name === toolName)?.inputFields ?? [];
  const canSubmit = toolName.trim() && (matcherKind === "path" ? pattern.trim() : field.trim() && values.trim());

  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        const matcher: PermissionMatcher =
          matcherKind === "path"
            ? { kind: "path", pattern: pattern.trim() }
            : { kind: "arg", field: field.trim(), values: values.split(",").map((value) => value.trim()).filter(Boolean) };
        createMutation.mutate({ workspaceId, toolName: toolName.trim(), matcher, decision, priority, enabled: true });
      }}
    >
      <h2 className="settings-subheading">新增规则</h2>
      {submitError && <div className="error-banner">{submitError}</div>}
      <label>
        工具
        <select value={toolName} onChange={(event) => { setToolName(event.target.value); setField(""); }}>
          <option value="">选择工具…</option>
          {toolNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        匹配方式
        <select value={matcherKind} onChange={(event) => setMatcherKind(event.target.value as "path" | "arg")}>
          <option value="path">路径 glob（如 tmp/**）</option>
          <option value="arg">参数值列表</option>
        </select>
      </label>
      {matcherKind === "path" ? (
        <label>
          路径模式
          <input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="例如 tmp/** 或 **/.env*" />
        </label>
      ) : (
        <>
          <label>
            参数字段
            {availableFields.length > 0 ? (
              <select value={field} onChange={(event) => setField(event.target.value)}>
                <option value="">选择字段…</option>
                {availableFields.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input value={field} onChange={(event) => setField(event.target.value)} placeholder="例如 task" />
            )}
          </label>
          <label>
            允许的值（逗号分隔）
            <input value={values} onChange={(event) => setValues(event.target.value)} placeholder="例如 test, typecheck" />
          </label>
        </>
      )}
      <label>
        决策
        <select value={decision} onChange={(event) => setDecision(event.target.value as "allow" | "deny" | "ask")}>
          <option value="allow">允许（不审批）</option>
          <option value="deny">拒绝（不执行）</option>
          <option value="ask">需要审批（默认行为）</option>
        </select>
      </label>
      <label>
        优先级（数字越大越优先）
        <input
          type="number"
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
      </label>
      <button disabled={!canSubmit || createMutation.isPending} type="submit">
        添加规则
      </button>
    </form>
  );
}
