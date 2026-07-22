import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useState, type ReactNode } from "react";
import { currentSessionIdAtom } from "../../atoms/current-session-atom";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import { viewAtom } from "../../atoms/view-atom";
import { createSession, createWorkspace, listSessions, listWorkspaces } from "../../api/client";
import {
  McpIcon,
  MemoryIcon,
  PermissionsIcon,
  PlusIcon,
  SkillsIcon,
  WorkflowIcon,
} from "./nav-icons";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useAtom(viewAtom);
  const [workspaceId, setWorkspaceId] = useAtom(currentWorkspaceIdAtom);
  const [currentSessionId, setCurrentSessionId] = useAtom(currentSessionIdAtom);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
    retry: 5,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5_000),
  });

  useEffect(() => {
    if (!workspaceId && workspaces.data && workspaces.data.length > 0) {
      setWorkspaceId(workspaces.data[0]!.id);
    }
  }, [workspaceId, workspaces.data, setWorkspaceId]);

  const sessions = useQuery({
    queryKey: ["sessions", workspaceId],
    queryFn: () => listSessions(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: async (created) => {
      setCurrentSessionId(null);
      setWorkspaceId(created.id);
      setWorkspaceDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => console.error("[shell] createWorkspace failed", error),
  });

  const createWorkspaceError = createWorkspaceMutation.isError
    ? createWorkspaceMutation.error instanceof Error ? createWorkspaceMutation.error.message : "创建 Workspace 失败"
    : null;

  const createSessionMutation = useMutation({
    mutationFn: () => createSession(workspaceId!),
    onSuccess: async (created) => {
      setCurrentSessionId(created.id);
      setView("chat");
      await queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] });
    },
    onError: (error) => {
      console.error("[shell] createSession failed", error);
    },
  });

  return (
    <main className="shell">
      <aside className="sidebar">
        <header>
          <span className="eyebrow">LOCAL AGENT</span>
          <h1>Co-Work Agent</h1>
        </header>

        <div className="workspace-select">
          <span>Workspace</span>
          <select
            value={workspaceId ?? ""}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                event.target.value = workspaceId ?? "";
                createWorkspaceMutation.reset();
                setWorkspaceDialogOpen(true);
                return;
              }
              setCurrentSessionId(null);
              setWorkspaceId(event.target.value);
            }}
          >
            {workspaces.data?.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
            <option value="__new__">+ New workspace</option>
          </select>
          {workspaces.isPending && <span className="workspace-status">正在连接 Agent Server…</span>}
          {workspaces.isError && (
            <span className="workspace-error">
              无法连接 Agent Server。
              <button type="button" className="text-button" onClick={() => void workspaces.refetch()}>重试</button>
            </span>
          )}
          {createWorkspaceError && <span className="workspace-error">{createWorkspaceError}</span>}
        </div>

        <nav className="nav-primary">
          <button className="nav-item" disabled={!workspaceId} onClick={() => createSessionMutation.mutate()}>
            <PlusIcon /> New chat
          </button>
          <button
            className={view === "skills" ? "nav-item active" : "nav-item"}
            onClick={() => setView("skills")}
          >
            <SkillsIcon /> Skills
          </button>
          <button
            className={view === "mcp-servers" ? "nav-item active" : "nav-item"}
            onClick={() => setView("mcp-servers")}
          >
            <McpIcon /> MCP Servers
          </button>
          <button
            className={view === "memory" ? "nav-item active" : "nav-item"}
            onClick={() => setView("memory")}
          >
            <MemoryIcon /> Memory
          </button>
          <button
            className={view === "workflows" ? "nav-item active" : "nav-item"}
            onClick={() => setView("workflows")}
          >
            <WorkflowIcon /> Workflow
          </button>
          <button
            className={view === "permissions" ? "nav-item active" : "nav-item"}
            onClick={() => setView("permissions")}
          >
            <PermissionsIcon /> Permissions
          </button>
        </nav>
        <h2 className="history-heading">Chat history</h2>
        <nav className="history">
          {sessions.data?.map((item) => (
            <button
              className={view === "chat" && item.id === currentSessionId ? "session active" : "session"}
              key={item.id}
              onClick={() => {
                setCurrentSessionId(item.id);
                setView("chat");
              }}
            >
              {item.title.startsWith("Workflow:") && <WorkflowIcon />}
              {item.title}
            </button>
          ))}
        </nav>
      </aside>
      {children}
      <CreateWorkspaceDialog
        open={workspaceDialogOpen}
        pending={createWorkspaceMutation.isPending}
        error={createWorkspaceError}
        onClose={() => {
          if (!createWorkspaceMutation.isPending) setWorkspaceDialogOpen(false);
        }}
        onSubmit={(name) => createWorkspaceMutation.mutate({ name })}
      />
    </main>
  );
}
