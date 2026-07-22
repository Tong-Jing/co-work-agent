import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, type ReactNode } from "react";
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

interface AppShellProps {
  currentSessionId: string | null;
  onSelectSession(sessionId: string): void;
  children: ReactNode;
}

export function AppShell({ currentSessionId, onSelectSession, children }: AppShellProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useAtom(viewAtom);
  const [workspaceId, setWorkspaceId] = useAtom(currentWorkspaceIdAtom);
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces });

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
      setWorkspaceId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => console.error("[shell] createWorkspace failed", error),
  });

  const createSessionMutation = useMutation({
    mutationFn: () => createSession(workspaceId!),
    onSuccess: async (created) => {
      setView("chat");
      onSelectSession(created.id);
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

        <label className="workspace-select">
          Workspace
          <select
            value={workspaceId ?? ""}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                const name = window.prompt("新建 Workspace 名称");
                if (name && name.trim()) createWorkspaceMutation.mutate({ name: name.trim() });
                return;
              }
              setWorkspaceId(event.target.value);
            }}
          >
            {workspaces.data?.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
            <option value="__new__">+ 新建 Workspace…</option>
          </select>
        </label>

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
                setView("chat");
                onSelectSession(item.id);
              }}
            >
              {item.title.startsWith("Workflow:") && <WorkflowIcon />}
              {item.title}
            </button>
          ))}
        </nav>
      </aside>
      {children}
    </main>
  );
}
