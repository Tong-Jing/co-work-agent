import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import type { MemoryEntry } from "@local-agent/contracts";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import {
  createMemory,
  deleteAutoMemory,
  deleteMemory,
  listArchivedMemories,
  listAutoMemories,
  listMemories,
  listWorkspaces,
  promoteAutoMemory,
  restoreMemory,
} from "../../api/client";
import { AppShell } from "../shell/AppShell";

type MemoryTab = "workspace" | "auto" | "archived";

function formatRecallStats(memory: MemoryEntry) {
  if (!memory.lastRecalledAt) return "从未被召回";
  const relative = new Date(memory.lastRecalledAt).toLocaleString();
  return `最近被召回: ${relative} · 命中 ${memory.recallCount} 次`;
}

export function MemoryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MemoryTab>("workspace");

  return (
    <AppShell>
      <section className="settings-page">
        <header className="settings-header">
          <h1>Memory</h1>
          <p className="muted">
            Workspace Memory 是已经确认、每次对话都会完整注入上下文的长期记忆；Auto Memory 是 Agent 在运行中自动产生的候选记忆，
            你可以挑选其中有价值的条目提升（Share）到 Workspace Memory；已归档记忆是被冲突检测判定为过时并自动取代的记忆。
          </p>
        </header>

        <div className="tabs">
          <button
            className={tab === "workspace" ? "tab active" : "tab"}
            onClick={() => setTab("workspace")}
          >
            Workspace Memory
          </button>
          <button
            className={tab === "auto" ? "tab active" : "tab"}
            onClick={() => setTab("auto")}
          >
            Auto Memory
          </button>
          <button
            className={tab === "archived" ? "tab active" : "tab"}
            onClick={() => setTab("archived")}
          >
            Archived (Conflicts)
          </button>
        </div>

        {tab === "workspace" && <WorkspaceMemoryTab queryClient={queryClient} />}
        {tab === "auto" && <AutoMemoryTab queryClient={queryClient} />}
        {tab === "archived" && <ArchivedMemoryTab queryClient={queryClient} />}
      </section>
    </AppShell>
  );
}

function WorkspaceMemoryTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const memories = useQuery({ queryKey: ["memories"], queryFn: listMemories });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");

  const categories = useMemo(
    () => [...new Set((memories.data ?? []).map((memory) => memory.category))].sort(),
    [memories.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (memories.data ?? []).filter((memory) => {
      const matchesCategory = categoryFilter === "__all__" || memory.category === categoryFilter;
      const matchesSearch = !term || memory.content.toLowerCase().includes(term) || memory.category.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [memories.data, search, categoryFilter]);

  const deleteMutation = useMutation({
    mutationFn: deleteMemory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (error) => console.error("[memory] delete failed", error),
  });

  return (
    <>
      <div className="memory-filter-bar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索记忆内容或分类…"
        />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="__all__">分类: 全部</option>
          {categories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>

      <h2 className="settings-subheading">全部 Workspace 的长期记忆 ({filtered.length})</h2>
      <div className="card-list">
        {filtered.map((memory) => (
          <article className="card" key={memory.id}>
            <div className="card-title">
              <strong>{memory.category}</strong>
              <span className="badge badge-custom">{memory.workspaceName}</span>
            </div>
            <p className="muted">{memory.content}</p>
            <div className="card-actions">
              <span className="status-on">{formatRecallStats(memory)}</span>
              <button
                className="secondary"
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(memory.id)}
              >
                删除
              </button>
            </div>
          </article>
        ))}
        {memories.data && memories.data.length === 0 && (
          <p className="muted">还没有任何 workspace 记录长期记忆。可以从 Auto Memory 中挑选条目分享过来，或在下方手动添加。</p>
        )}
        {memories.data && memories.data.length > 0 && filtered.length === 0 && (
          <p className="muted">没有匹配搜索条件的记忆。</p>
        )}
      </div>

      <CreateMemoryForm queryClient={queryClient} categories={categories} />
    </>
  );
}

function CreateMemoryForm({ queryClient, categories }: { queryClient: ReturnType<typeof useQueryClient>; categories: string[] }) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces });
  const currentWorkspaceName = workspaces.data?.find((workspace) => workspace.id === workspaceId)?.name;

  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");

  const createMutation = useMutation({
    mutationFn: createMemory,
    onSuccess: async () => {
      setCategory("");
      setContent("");
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (error) => console.error("[memory] create failed", error),
  });

  const submitError = createMutation.isError
    ? createMutation.error instanceof Error ? createMutation.error.message : "创建失败"
    : null;

  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!workspaceId || !category.trim() || !content.trim()) return;
        createMutation.mutate({ workspaceId, category: category.trim(), content: content.trim() });
      }}
    >
      <h2 className="settings-subheading">手动添加 Memory（写入当前 Workspace：{currentWorkspaceName ?? "未选择"}）</h2>
      {submitError && <div className="error-banner">{submitError}</div>}
      {!workspaceId && <div className="error-banner">请先在左侧选择一个 workspace</div>}
      <label>
        分类
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="例如 convention / decision"
          list="memory-category-options"
        />
        <datalist id="memory-category-options">
          {categories.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
      <label>
        内容
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="团队约定或重要决策内容"
          rows={4}
        />
      </label>
      <button disabled={!workspaceId || !category.trim() || !content.trim() || createMutation.isPending} type="submit">
        添加
      </button>
    </form>
  );
}

function AutoMemoryTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const autoMemories = useQuery({ queryKey: ["auto-memories"], queryFn: listAutoMemories });
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});

  const promoteMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) => promoteAutoMemory(id, { category }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["auto-memories"] }),
        queryClient.invalidateQueries({ queryKey: ["memories"] }),
      ]);
    },
    onError: (error) => console.error("[auto-memory] promote failed", error),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAutoMemory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auto-memories"] });
    },
    onError: (error) => console.error("[auto-memory] delete failed", error),
  });

  return (
    <>
      <h2 className="settings-subheading">Agent 自动产生的候选记忆</h2>
      <div className="card-list">
        {autoMemories.data?.map((entry) => {
          const isShared = Boolean(entry.sharedMemoryId);
          const category = categoryDrafts[entry.id] ?? "";
          return (
            <article className={isShared ? "card card-shared" : "card"} key={entry.id}>
              <div className="card-title">
                <span className="badge badge-custom">{entry.workspaceName}</span>
                {isShared && <span className="badge">已分享</span>}
                <span className="badge">命中 {entry.hitCount} 次</span>
              </div>
              <p className="muted">{entry.content}</p>
              <span className="status-off">{new Date(entry.createdAt).toLocaleString()}</span>
              {!isShared && (
                <div className="card-actions">
                  <input
                    placeholder="分类，如 convention"
                    value={category}
                    onChange={(event) => setCategoryDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={!category.trim() || promoteMutation.isPending}
                    onClick={() => promoteMutation.mutate({ id: entry.id, category: category.trim() })}
                  >
                    Share to Workspace
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(entry.id)}
                  >
                    删除
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {autoMemories.data && autoMemories.data.length === 0 && (
          <p className="muted">Agent 还没有在此 workspace 产生自动记忆，多进行几次对话后会在这里出现候选记忆。</p>
        )}
      </div>
    </>
  );
}

function ArchivedMemoryTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const archived = useQuery({ queryKey: ["memories", "archived"], queryFn: listArchivedMemories });
  const allMemories = useQuery({ queryKey: ["memories"], queryFn: listMemories });

  const restoreMutation = useMutation({
    mutationFn: restoreMemory,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memories", "archived"] }),
        queryClient.invalidateQueries({ queryKey: ["memories"] }),
      ]);
    },
    onError: (error) => console.error("[memory] restore failed", error),
  });

  const supersededByName = (id: string | null) => {
    if (!id) return null;
    return allMemories.data?.find((memory) => memory.id === id)?.content ?? null;
  };

  return (
    <>
      <h2 className="settings-subheading">Archived (Conflicts)</h2>
      <p className="muted page-intro">
        当新记忆与已有记忆判定矛盾时，旧记忆会被自动归档而非删除。如果判断有误，可以在这里恢复。
      </p>
      <div className="card-list">
        {archived.data?.map((memory) => (
          <article className="card card-shared" key={memory.id}>
            <div className="card-title">
              <strong className="strikethrough">{memory.category}</strong>
              <span className="badge status-deny">已归档</span>
            </div>
            <p className="muted strikethrough">{memory.content}</p>
            {supersededByName(memory.supersededBy) && (
              <p className="muted">
                被判定为冲突并取代: 「{supersededByName(memory.supersededBy)}」
              </p>
            )}
            <div className="card-actions">
              <span className="status-off">归档于 {new Date(memory.createdAt).toLocaleString()}</span>
              <button
                type="button"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(memory.id)}
              >
                恢复此记忆
              </button>
            </div>
          </article>
        ))}
        {archived.data && archived.data.length === 0 && (
          <p className="muted">目前没有被归档的记忆。</p>
        )}
      </div>
    </>
  );
}
