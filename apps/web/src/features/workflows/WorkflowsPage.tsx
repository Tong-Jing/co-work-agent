import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import type { CreateWorkflowRequest, WorkflowDefinition, WorkflowNode } from "@local-agent/contracts";
import { currentSessionIdAtom } from "../../atoms/current-session-atom";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import { viewAtom } from "../../atoms/view-atom";
import {
  createWorkflow,
  deleteWorkflow,
  listSkills,
  listTools,
  listWorkflows,
  startWorkflowRun,
  updateWorkflow,
} from "../../api/client";
import { AppShell } from "../shell/AppShell";

type NodeType = WorkflowNode["type"];

interface NodeFormValue {
  id: string;
  type: NodeType;
  label: string;
  promptTemplate: string;
  skillId: string;
  toolName: string;
  argsTemplate: Array<{ key: string; value: string }>;
  question: string;
  outputVariable: string;
}

function makeNodeId() {
  return `n${Math.random().toString(36).slice(2, 9)}`;
}

function emptyNode(): NodeFormValue {
  return {
    id: makeNodeId(),
    type: "prompt",
    label: "",
    promptTemplate: "",
    skillId: "",
    toolName: "",
    argsTemplate: [],
    question: "",
    outputVariable: "",
  };
}

function nodeToFormValue(node: WorkflowNode): NodeFormValue {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    promptTemplate: node.type === "prompt" ? node.promptTemplate : "",
    skillId: node.type === "skill" ? node.skillId : "",
    toolName: node.type === "tool" ? node.toolName : "",
    argsTemplate: node.type === "tool" ? Object.entries(node.argsTemplate).map(([key, value]) => ({ key, value })) : [],
    question: node.type === "user_input" ? node.question : "",
    outputVariable: node.outputVariable,
  };
}

function formValueToNode(value: NodeFormValue): WorkflowNode {
  const base = { id: value.id, label: value.label.trim() || value.type, outputVariable: value.outputVariable.trim() || `step_${value.id}` };
  if (value.type === "prompt") return { ...base, type: "prompt", promptTemplate: value.promptTemplate };
  if (value.type === "skill") return { ...base, type: "skill", skillId: value.skillId };
  if (value.type === "user_input") return { ...base, type: "user_input", question: value.question };
  return {
    ...base,
    type: "tool",
    toolName: value.toolName,
    argsTemplate: Object.fromEntries(value.argsTemplate.filter((entry) => entry.key.trim()).map((entry) => [entry.key.trim(), entry.value])),
  };
}

function nodeTypeLabel(type: NodeType) {
  if (type === "prompt") return "Prompt";
  if (type === "skill") return "Skill";
  if (type === "user_input") return "用户提问";
  return "工具调用";
}

/** Example workflow: read and summarize this project's own codebase, then write out an evolution-direction report. */
function selfAssessmentExample(workspaceId: string): CreateWorkflowRequest {
  return {
    workspaceId,
    name: "Co-Work Agent 自测与进化",
    description: "读取并总结当前 Agent 系统的功能实现，输出改进建议与进化方向报告",
    version: "1.0.0",
    nodes: [
      {
        id: "n1",
        type: "tool",
        label: "扫描仓库结构",
        toolName: "list_files",
        argsTemplate: { path: ".", depth: "3" },
        outputVariable: "repo_structure",
      },
      {
        id: "n2",
        type: "tool",
        label: "读取共享契约定义",
        toolName: "read_file",
        argsTemplate: { path: "packages/contracts/src/index.ts" },
        outputVariable: "contracts_snapshot",
      },
      {
        id: "n3",
        type: "prompt",
        label: "总结当前功能模块",
        promptTemplate:
          "基于以下仓库结构和契约定义，总结当前 Co-Work Agent 项目具备的核心功能模块（Agent 循环、Skills、Memory、Permissions、Workflow、MCP 等）:\n仓库结构: {{repo_structure}}\n契约定义: {{contracts_snapshot}}",
        outputVariable: "feature_summary",
      },
      {
        id: "n4",
        type: "skill",
        label: "代码级问题排查",
        skillId: "code-review",
        outputVariable: "code_findings",
      },
      {
        id: "n5",
        type: "prompt",
        label: "生成进化方向报告",
        promptTemplate:
          "基于以下功能总结和代码级发现，输出一份结构化的进化方向报告，包含：1) 当前能力清单 2) 已识别的技术债/局限 3) 可执行的改进建议(按优先级排序) 4) 长期演进方向:\n功能总结: {{feature_summary}}\n代码发现: {{code_findings}}",
        outputVariable: "evolution_report",
      },
      {
        id: "n6",
        type: "tool",
        label: "写入报告文件",
        toolName: "write_file",
        argsTemplate: { path: "EVOLUTION.md", content: "{{evolution_report}}" },
        outputVariable: "write_result",
      },
    ],
  };
}

/** Example workflow: interactively ask which Skill to evaluate, then run and grade it. */
function skillEvaluationExample(workspaceId: string): CreateWorkflowRequest {
  return {
    workspaceId,
    name: "Skill 测评",
    description: "交互式测评项目中某个 Skill 的表现质量：先询问要测评哪个 Skill，再进行分析和实际执行",
    version: "1.0.0",
    nodes: [
      {
        id: "n1",
        type: "user_input",
        label: "询问要测评的 Skill",
        question: "请问你想测评哪个 Skill？请输入 Skill 的 id（如 code-review 或 testing）。",
        outputVariable: "target_skill_id",
      },
      {
        id: "n2",
        type: "prompt",
        label: "静态分析 Skill 定义",
        promptTemplate:
          "请查看 id 为 '{{target_skill_id}}' 的 skill 的定义(可通过读取 apps/agent-server/bundled-skills/{{target_skill_id}}/SKILL.md 或数据库中的自定义 skill 记录)，分析它的 instructions 是否清晰、requiredTools 是否合理覆盖了它需要的能力、taskTypes 标签是否有助于被正确匹配选中。",
        outputVariable: "static_analysis",
      },
      {
        id: "n3",
        type: "skill",
        label: "实际执行目标 Skill",
        skillId: "{{target_skill_id}}",
        outputVariable: "live_execution_result",
      },
      {
        id: "n4",
        type: "prompt",
        label: "生成测评报告",
        promptTemplate:
          "基于静态分析和实际执行结果，给这个 Skill 打分（1-5分）并给出具体改进建议:\n静态分析: {{static_analysis}}\n实际执行: {{live_execution_result}}",
        outputVariable: "evaluation_report",
      },
      {
        id: "n5",
        type: "tool",
        label: "写入测评报告",
        toolName: "write_file",
        argsTemplate: { path: "skill-evaluations/{{target_skill_id}}-eval.md", content: "{{evaluation_report}}" },
        outputVariable: "write_result",
      },
    ],
  };
}

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const setView = useSetAtom(viewAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);

  const workflows = useQuery({
    queryKey: ["workflows", workspaceId],
    queryFn: () => listWorkflows(workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const skills = useQuery({ queryKey: ["skills"], queryFn: listSkills });
  const tools = useQuery({ queryKey: ["tools"], queryFn: listTools });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [nodes, setNodes] = useState<NodeFormValue[]>([]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setVersion("1.0.0");
    setNodes([]);
  };

  const createMutation = useMutation({
    mutationFn: createWorkflow,
    onSuccess: async () => {
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["workflows", workspaceId] });
    },
    onError: (error) => console.error("[workflows] create failed", error),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateWorkflow>[1] }) => updateWorkflow(id, input),
    onSuccess: async () => {
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["workflows", workspaceId] });
    },
    onError: (error) => console.error("[workflows] update failed", error),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflows", workspaceId] });
    },
    onError: (error) => console.error("[workflows] delete failed", error),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => startWorkflowRun(id),
    onSuccess: async ({ sessionId }) => {
      setCurrentSessionId(sessionId);
      setView("chat");
      await queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] });
    },
    onError: (error) => console.error("[workflows] run failed", error),
  });

  const seedExamplesMutation = useMutation({
    mutationFn: async (id: string) => {
      await createWorkflow(selfAssessmentExample(id));
      await createWorkflow(skillEvaluationExample(id));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflows", workspaceId] });
    },
    onError: (error) => console.error("[workflows] seed examples failed", error),
  });

  const startEdit = (workflow: WorkflowDefinition) => {
    setEditingId(workflow.id);
    setName(workflow.name);
    setDescription(workflow.description);
    setVersion(workflow.version);
    setNodes(workflow.nodes.map(nodeToFormValue));
  };

  const activeMutation = editingId ? updateMutation : createMutation;
  const submitError = activeMutation.isError
    ? activeMutation.error instanceof Error ? activeMutation.error.message : "保存失败"
    : null;

  const updateNode = (id: string, changes: Partial<NodeFormValue>) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, ...changes } : node)));
  };

  const removeNode = (id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id));
  };

  const canSubmit = name.trim() && nodes.length > 0 && nodes.every((node) => node.outputVariable.trim());

  return (
    <AppShell>
      <section className="settings-page">
        <header className="settings-header">
          <h1>Workflow</h1>
          <p className="muted">
            编排多步骤任务：按顺序串联 Prompt / Skill / 用户提问 / 工具调用步骤。每次点击「运行」都会新建一个独立会话来执行，
            便于在 Chat 历史中回看完整过程。
          </p>
        </header>

        {!workspaceId && <p className="muted">请先在左侧选择一个 workspace。</p>}

        {workspaceId && (
          <>
            <h2 className="settings-subheading">当前 Workspace 的 Workflow</h2>
            <div className="card-list">
              {workflows.data?.map((workflow) => (
                <article className="card" key={workflow.id}>
                  <div className="card-title">
                    <strong>{workflow.name}</strong>
                    <span className="badge badge-custom">v{workflow.version}</span>
                    <span className="muted">{workflow.nodes.length} 步</span>
                  </div>
                  <p className="muted">{workflow.description || "（无简介）"}</p>
                  <div className="card-actions">
                    <button disabled={runMutation.isPending} onClick={() => runMutation.mutate(workflow.id)}>
                      运行▶
                    </button>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="secondary" type="button" onClick={() => startEdit(workflow)}>
                        编辑
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => window.alert("分享功能即将上线")}
                      >
                        分享
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(workflow.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {workflows.data && workflows.data.length === 0 && (
                <div>
                  <p className="muted">还没有 Workflow。</p>
                  <button
                    type="button"
                    className="secondary"
                    disabled={seedExamplesMutation.isPending}
                    onClick={() => seedExamplesMutation.mutate(workspaceId)}
                  >
                    创建示例 Workflow（自测与进化 + Skill 测评）
                  </button>
                </div>
              )}
            </div>

            <form
              className="settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canSubmit || !workspaceId) return;
                const payload = {
                  name: name.trim(),
                  description: description.trim(),
                  version: version.trim() || "1.0.0",
                  nodes: nodes.map(formValueToNode),
                };
                if (editingId) updateMutation.mutate({ id: editingId, input: payload });
                else createMutation.mutate({ workspaceId, ...payload });
              }}
            >
              <h2 className="settings-subheading">{editingId ? "编辑 Workflow" : "新建 Workflow"}</h2>
              {submitError && <div className="error-banner">{submitError}</div>}
              <label>
                名称
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 PRD to PRs" />
              </label>
              <label>
                简介
                <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话描述这个 Workflow 的用途" />
              </label>
              <label>
                版本
                <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" />
              </label>

              <div className="workflow-steps">
                {nodes.map((node, index) => (
                  <div className="workflow-step" key={node.id}>
                    <div className="workflow-step-header">
                      <span className="badge badge-custom">步骤 {index + 1}</span>
                      <button type="button" className="secondary" onClick={() => removeNode(node.id)}>
                        删除
                      </button>
                    </div>
                    <label>
                      类型
                      <select
                        value={node.type}
                        onChange={(event) => updateNode(node.id, { type: event.target.value as NodeType })}
                      >
                        <option value="prompt">Prompt</option>
                        <option value="skill">Skill</option>
                        <option value="user_input">用户提问</option>
                        <option value="tool">工具调用</option>
                      </select>
                    </label>
                    <label>
                      步骤名称
                      <input
                        value={node.label}
                        onChange={(event) => updateNode(node.id, { label: event.target.value })}
                        placeholder={`例如 ${nodeTypeLabel(node.type)}步骤`}
                      />
                    </label>

                    {node.type === "prompt" && (
                      <label>
                        Prompt 模板（支持 {"{{"}变量名{"}}"} 引用前序步骤输出）
                        <textarea
                          value={node.promptTemplate}
                          onChange={(event) => updateNode(node.id, { promptTemplate: event.target.value })}
                          rows={4}
                          placeholder="例如：根据以下PRD生成设计文档: {{prd_content}}"
                        />
                      </label>
                    )}

                    {node.type === "skill" && (
                      <label>
                        选择 Skill（也可以填 {"{{"}变量名{"}}"} 引用前面的「用户提问」步骤，实现动态选择）
                        <select value={node.skillId} onChange={(event) => updateNode(node.id, { skillId: event.target.value })}>
                          <option value="">选择 Skill…</option>
                          {(skills.data ?? []).map((skill) => (
                            <option key={skill.id} value={skill.id}>{skill.name}</option>
                          ))}
                        </select>
                        <input
                          value={node.skillId}
                          onChange={(event) => updateNode(node.id, { skillId: event.target.value })}
                          placeholder="或直接输入，如 {{target_skill_id}}"
                          style={{ marginTop: 6 }}
                        />
                      </label>
                    )}

                    {node.type === "user_input" && (
                      <label>
                        向用户提出的问题（运行到此步骤时会作为 Agent 消息发送，并暂停等待你在对话框里回复）
                        <textarea
                          value={node.question}
                          onChange={(event) => updateNode(node.id, { question: event.target.value })}
                          rows={2}
                          placeholder="例如：请问你想测评哪个 Skill？"
                        />
                      </label>
                    )}

                    {node.type === "tool" && (
                      <>
                        <label>
                          选择工具
                          <select value={node.toolName} onChange={(event) => updateNode(node.id, { toolName: event.target.value })}>
                            <option value="">选择工具…</option>
                            {(tools.data ?? []).map((tool) => (
                              <option key={tool.name} value={tool.name}>{tool.name}</option>
                            ))}
                          </select>
                        </label>
                        <ArgsTemplateEditor
                          value={node.argsTemplate}
                          onChange={(argsTemplate) => updateNode(node.id, { argsTemplate })}
                        />
                      </>
                    )}

                    <label>
                      输出变量名（供后续步骤通过 {"{{"}变量名{"}}"} 引用）
                      <input
                        value={node.outputVariable}
                        onChange={(event) => updateNode(node.id, { outputVariable: event.target.value })}
                        placeholder="例如 design_doc"
                      />
                    </label>
                  </div>
                ))}
              </div>

              <button type="button" className="secondary" onClick={() => setNodes((current) => [...current, emptyNode()])}>
                + 添加步骤
              </button>

              <div className="card-actions">
                <button disabled={!canSubmit || activeMutation.isPending} type="submit">
                  {editingId ? "保存修改" : "创建"}
                </button>
                {editingId && (
                  <button type="button" className="secondary" onClick={resetForm}>
                    取消编辑
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </AppShell>
  );
}

function ArgsTemplateEditor({
  value,
  onChange,
}: {
  value: Array<{ key: string; value: string }>;
  onChange(next: Array<{ key: string; value: string }>): void;
}) {
  return (
    <label>
      参数（key = 参数名，value 支持 {"{{"}变量名{"}}"} 引用）
      <div className="args-template-list">
        {value.map((entry, index) => (
          <div className="args-template-row" key={index}>
            <input
              value={entry.key}
              onChange={(event) => {
                const next = [...value];
                next[index] = { ...entry, key: event.target.value };
                onChange(next);
              }}
              placeholder="参数名，如 message"
            />
            <input
              value={entry.value}
              onChange={(event) => {
                const next = [...value];
                next[index] = { ...entry, value: event.target.value };
                onChange(next);
              }}
              placeholder="值，如 {{design_doc}}"
            />
            <button type="button" className="secondary" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              移除
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => onChange([...value, { key: "", value: "" }])}>
          + 添加参数
        </button>
      </div>
    </label>
  );
}
