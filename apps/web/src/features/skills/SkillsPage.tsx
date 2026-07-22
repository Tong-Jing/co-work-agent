import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { SkillEntry, SkillRisk, ToolInfo } from "@local-agent/contracts";
import { createSkill, deleteSkill, listSkills, listTools, updateSkill } from "../../api/client";
import { AppShell } from "../shell/AppShell";

function riskLabel(risk: SkillRisk) {
  if (risk === "low") return "低风险";
  if (risk === "medium") return "中风险";
  return "高风险";
}

function riskClass(risk: SkillRisk) {
  if (risk === "low") return "status-on";
  if (risk === "medium") return "status-off";
  return "status-deny";
}

/** Mirrors SkillSelector's keyword-match scoring so the preview works without a round trip. */
function scoreSkill(prompt: string, skill: SkillEntry): number {
  const terms = new Set(prompt.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 2));
  const haystack = `${skill.name} ${skill.description} ${skill.taskTypes.join(" ")}`.toLowerCase();
  return [...terms].filter((term) => haystack.includes(term)).length;
}

interface SkillFormValue {
  name: string;
  description: string;
  instructions: string;
  version: string;
  risk: SkillRisk;
  taskTypes: string[];
  requiredTools: string[];
}

const emptyForm: SkillFormValue = {
  name: "",
  description: "",
  instructions: "",
  version: "1.0.0",
  risk: "low",
  taskTypes: [],
  requiredTools: [],
};

export function SkillsPage() {
  const queryClient = useQueryClient();
  const skills = useQuery({ queryKey: ["skills"], queryFn: listSkills });
  const tools = useQuery({ queryKey: ["tools"], queryFn: listTools });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SkillFormValue>(emptyForm);
  const [previewPrompt, setPreviewPrompt] = useState("");

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const createMutation = useMutation({
    mutationFn: createSkill,
    onSuccess: async () => {
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (error) => console.error("[skills] create failed", error),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SkillFormValue }) => updateSkill(id, input),
    onSuccess: async () => {
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (error) => console.error("[skills] update failed", error),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSkill,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (error) => console.error("[skills] delete failed", error),
  });

  const startEdit = (skill: SkillEntry) => {
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      version: skill.version,
      risk: skill.risk,
      taskTypes: skill.taskTypes,
      requiredTools: skill.requiredTools,
    });
  };

  const activeMutation = editingId ? updateMutation : createMutation;
  const submitError = activeMutation.isError
    ? activeMutation.error instanceof Error ? activeMutation.error.message : "保存失败"
    : null;

  const knownToolNames = useMemo(() => new Set((tools.data ?? []).map((tool) => tool.name)), [tools.data]);

  const previewResults = useMemo(() => {
    if (!previewPrompt.trim() || !skills.data) return [];
    return skills.data
      .map((skill) => ({ skill, score: scoreSkill(previewPrompt, skill) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
  }, [previewPrompt, skills.data]);

  const bundled = skills.data?.filter((skill) => skill.source === "bundled") ?? [];
  const custom = skills.data?.filter((skill) => skill.source === "custom") ?? [];

  return (
    <AppShell>
      <section className="settings-page">
        <header className="settings-header">
          <h1>Skills</h1>
          <p className="muted">
            管理 Agent 可选用的技能。命中的 Skill 会把 instructions 注入上下文，并可通过「关联工具」收窄本轮可用的工具集。
            内置技能只读，可在下方新增或编辑自定义技能。
          </p>
        </header>

        <div className="skill-preview">
          <label>
            匹配预览 — 试试输入一句任务描述，看看会命中哪些 Skill
            <input
              value={previewPrompt}
              onChange={(event) => setPreviewPrompt(event.target.value)}
              placeholder="例如：帮我 review 这个 PR 的安全性"
            />
          </label>
          {previewPrompt.trim() && (
            <div className="skill-preview-results">
              {previewResults.length === 0 && <span className="muted">没有 Skill 命中这句话</span>}
              {previewResults.map(({ skill, score }) => (
                <span key={skill.id} className="badge status-on">{skill.name} · score {score}</span>
              ))}
            </div>
          )}
        </div>

        <h2 className="settings-subheading">默认 Skills</h2>
        <div className="card-list">
          {bundled.map((skill) => (
            <SkillCard key={skill.id} skill={skill} knownToolNames={knownToolNames} />
          ))}
          {bundled.length === 0 && <p className="muted">暂无内置 Skill。</p>}
        </div>

        <h2 className="settings-subheading">自定义 Skills</h2>
        <div className="card-list">
          {custom.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              knownToolNames={knownToolNames}
              onEdit={() => startEdit(skill)}
              onDelete={() => deleteMutation.mutate(skill.id)}
              deleting={deleteMutation.isPending}
            />
          ))}
          {custom.length === 0 && <p className="muted">还没有自定义 Skill。</p>}
        </div>

        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.name.trim() || !form.instructions.trim()) return;
            const payload = {
              name: form.name.trim(),
              description: form.description.trim(),
              instructions: form.instructions.trim(),
              version: form.version.trim() || "1.0.0",
              risk: form.risk,
              taskTypes: form.taskTypes,
              requiredTools: form.requiredTools,
            };
            if (editingId) updateMutation.mutate({ id: editingId, input: payload });
            else createMutation.mutate(payload);
          }}
        >
          <h2 className="settings-subheading">{editingId ? "编辑 Skill" : "新增 Skill"}</h2>
          {submitError && <div className="error-banner">{submitError}</div>}
          <label>
            名称
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 API Review" />
          </label>
          <label>
            简介
            <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="一句话描述这个技能的用途" />
          </label>
          <label>
            版本
            <input value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} placeholder="1.0.0" />
          </label>
          <label>
            风险等级
            <div className="risk-radio-group">
              {(["low", "medium", "high"] as const).map((risk) => (
                <label key={risk}>
                  <input
                    type="radio"
                    name="risk"
                    checked={form.risk === risk}
                    onChange={() => setForm((current) => ({ ...current, risk }))}
                  />
                  {riskLabel(risk)}
                </label>
              ))}
            </div>
          </label>
          <label>
            任务类型
            <ChipInput
              values={form.taskTypes}
              onChange={(taskTypes) => setForm((current) => ({ ...current, taskTypes }))}
              placeholder="输入后按回车添加，例如 api-review"
            />
          </label>
          <label>
            关联工具（选中后，命中此 Skill 时会把可用工具收窄到这些 + 基础工具）
            <div className="tool-checkbox-grid">
              {(tools.data ?? []).map((tool) => (
                <ToolCheckbox
                  key={tool.name}
                  tool={tool}
                  checked={form.requiredTools.includes(tool.name)}
                  onToggle={(checked) =>
                    setForm((current) => ({
                      ...current,
                      requiredTools: checked
                        ? [...current.requiredTools, tool.name]
                        : current.requiredTools.filter((name) => name !== tool.name),
                    }))
                  }
                />
              ))}
            </div>
          </label>
          <label>
            指令内容
            <textarea
              value={form.instructions}
              onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
              placeholder="Agent 在使用该技能时应遵循的具体指令"
              rows={8}
            />
          </label>
          <div className="card-actions">
            <button disabled={!form.name.trim() || !form.instructions.trim() || activeMutation.isPending} type="submit">
              {editingId ? "保存修改" : "添加"}
            </button>
            {editingId && (
              <button type="button" className="secondary" onClick={resetForm}>
                取消编辑
              </button>
            )}
          </div>
        </form>
      </section>
    </AppShell>
  );
}

function ToolCheckbox({ tool, checked, onToggle }: { tool: ToolInfo; checked: boolean; onToggle(checked: boolean): void }) {
  return (
    <label className="tool-checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} />
      {tool.name}
      <span className={`badge ${riskClass(tool.risk)}`}>{riskLabel(tool.risk)}</span>
    </label>
  );
}

function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange(values: string[]): void; placeholder?: string }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft("");
  };

  return (
    <div>
      <div className="chip-input-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder={placeholder}
        />
      </div>
      {values.length > 0 && (
        <div className="chip-list" style={{ marginTop: 6 }}>
          {values.map((value) => (
            <span className="chip" key={value}>
              {value}
              <button type="button" aria-label={`移除 ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface SkillCardProps {
  skill: SkillEntry;
  knownToolNames: Set<string>;
  onEdit?(): void;
  onDelete?(): void;
  deleting?: boolean;
}

function SkillCard({ skill, knownToolNames, onEdit, onDelete, deleting }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);
  const unknownTools = skill.requiredTools.filter((name) => !knownToolNames.has(name));

  return (
    <article className="card">
      <div className="card-title">
        <strong>{skill.name}</strong>
        <span className="badge">{skill.source === "bundled" ? "内置" : "自定义"}</span>
        <span className="badge badge-custom">v{skill.version}</span>
        <span className={`badge ${riskClass(skill.risk)}`}>{riskLabel(skill.risk)}</span>
      </div>
      <p className="muted">{skill.description || "（无简介）"}</p>

      {skill.taskTypes.length > 0 && (
        <div className="chip-list">
          {skill.taskTypes.map((type) => (
            <span className="chip" key={type}>{type}</span>
          ))}
        </div>
      )}

      {skill.requiredTools.length > 0 && (
        <p className="card-tool-list">
          关联工具:{" "}
          {skill.requiredTools.map((name, index) => (
            <span key={name} className={unknownTools.includes(name) ? "card-tool-missing" : undefined}>
              {index > 0 ? " · " : ""}
              {name}
            </span>
          ))}
        </p>
      )}
      {unknownTools.length > 0 && (
        <p className="status-deny">⚠️ 未识别的工具名：{unknownTools.join(", ")}（请检查拼写，否则该 Skill 命中后不会真正收窄工具集）</p>
      )}

      <div className="card-actions">
        <button className="secondary" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "收起 instructions" : "查看完整 instructions"}
        </button>
        {(onEdit || onDelete) && (
          <div style={{ display: "flex", gap: 8 }}>
            {onEdit && (
              <button className="secondary" type="button" onClick={onEdit}>
                编辑
              </button>
            )}
            {onDelete && (
              <button className="secondary" type="button" disabled={deleting} onClick={onDelete}>
                删除
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && <pre className="event-details">{skill.instructions}</pre>}
    </article>
  );
}
