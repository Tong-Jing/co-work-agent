import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CreateMcpServerRequest, McpServerEntry } from "@local-agent/contracts";
import { createMcpServer, deleteMcpServer, listMcpServers, testMcpConnection, toggleMcpServer } from "../../api/client";
import { AppShell } from "../shell/AppShell";

function commandLine(server: McpServerEntry) {
  return server.type === "http" ? server.url : `${server.command} ${(server.args ?? []).join(" ")}`;
}

function connectionBadge(server: McpServerEntry) {
  if (!server.enabled) return null;
  if (server.connectionState === "connected") return <span className="badge status-on">🟢 已连接</span>;
  if (server.connectionState === "failed") return <span className="badge status-deny">🔴 连接失败</span>;
  return <span className="badge status-off">⚪ 未测试</span>;
}

function ToolListDisclosure({ toolNames }: { toolNames: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (toolNames.length === 0) return null;

  return (
    <div>
      <button type="button" className="secondary" onClick={() => setExpanded((current) => !current)}>
        提供 {toolNames.length} 个工具 {expanded ? "▴" : "▾"}
      </button>
      {expanded && (
        <pre className="event-details">{toolNames.join("\n")}</pre>
      )}
    </div>
  );
}

export function McpServersPage() {
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: ["mcp-servers"], queryFn: listMcpServers, refetchInterval: 5000 });

  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; toolCount: number; errorMessage: string | null } | null>(null);

  const createMutation = useMutation({
    mutationFn: createMcpServer,
    onSuccess: async () => {
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setTestResult(null);
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (error) => console.error("[mcp-servers] create failed", error),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (error) => console.error("[mcp-servers] delete failed", error),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleMcpServer(id, enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (error) => console.error("[mcp-servers] toggle failed", error),
  });

  const testMutation = useMutation({
    mutationFn: testMcpConnection,
    onSuccess: (result) => setTestResult(result),
    onError: (error) => {
      console.error("[mcp-servers] test connection failed", error);
      setTestResult({ success: false, toolCount: 0, errorMessage: error instanceof Error ? error.message : "测试失败" });
    },
  });

  const submitError = createMutation.isError
    ? createMutation.error instanceof Error ? createMutation.error.message : "创建失败"
    : null;

  const canSubmit = name.trim() && (type === "stdio" ? command.trim() : url.trim());

  const buildRequest = (): CreateMcpServerRequest =>
    type === "stdio"
      ? { type: "stdio", name: name.trim(), command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [], enabled: true }
      : { type: "http", name: name.trim(), url: url.trim(), enabled: true };

  return (
    <AppShell currentSessionId={null} onSelectSession={() => {}}>
      <section className="settings-page">
        <header className="settings-header">
          <h1>MCP Servers</h1>
          <p className="muted">
            管理 Agent 可连接的 MCP 服务，支持本地 stdio 进程和远程 HTTP 服务两种类型。内置服务可直接勾选启用/禁用（需要重启服务后生效），也可在下方添加自定义服务。
          </p>
        </header>

        <h2 className="settings-subheading">默认 MCP Servers</h2>
        <div className="card-list">
          {servers.data?.filter((server) => server.source === "builtin").map((server) => (
            <article className="card" key={server.id}>
              <div className="card-title">
                <strong>{server.name}</strong>
                <span className="badge">内置</span>
                <span className="badge badge-custom">{server.type}</span>
                {connectionBadge(server)}
              </div>
              <code className="card-command">{commandLine(server)}</code>
              {server.connectionState === "failed" && server.errorMessage && (
                <p className="status-deny">⚠️ 上次连接失败: {server.errorMessage}</p>
              )}
              <ToolListDisclosure toolNames={server.toolNames} />
              <div className="card-actions">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    disabled={toggleMutation.isPending}
                    onChange={(event) => toggleMutation.mutate({ id: server.id, enabled: event.target.checked })}
                  />
                  <span className={server.enabled ? "status-on" : "status-off"}>
                    {server.enabled ? "已启用" : "已禁用"}
                  </span>
                </label>
              </div>
            </article>
          ))}
          {servers.data && servers.data.filter((server) => server.source === "builtin").length === 0 && (
            <p className="muted">暂无内置 MCP Server。</p>
          )}
        </div>

        <h2 className="settings-subheading">自定义 MCP Servers</h2>
        <div className="card-list">
          {servers.data?.filter((server) => server.source === "custom").map((server) => (
            <article className="card" key={server.id}>
              <div className="card-title">
                <strong>{server.name}</strong>
                <span className="badge badge-custom">自定义</span>
                <span className="badge badge-custom">{server.type}</span>
                {connectionBadge(server)}
              </div>
              <code className="card-command">{commandLine(server)}</code>
              {server.connectionState === "failed" && server.errorMessage && (
                <p className="status-deny">⚠️ 上次连接失败: {server.errorMessage}</p>
              )}
              <ToolListDisclosure toolNames={server.toolNames} />
              <div className="card-actions">
                <span className={server.enabled ? "status-on" : "status-off"}>
                  {server.enabled ? "已启用" : "已禁用"}
                </span>
                <button
                  className="secondary"
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(server.id)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
          {servers.data && servers.data.filter((server) => server.source === "custom").length === 0 && (
            <p className="muted">还没有自定义 MCP Server。</p>
          )}
        </div>

        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            createMutation.mutate(buildRequest());
          }}
        >
          <h2 className="settings-subheading">添加自定义 MCP Server</h2>
          {submitError && <div className="error-banner">{submitError}</div>}
          <label>
            类型
            <select value={type} onChange={(event) => { setType(event.target.value as "stdio" | "http"); setTestResult(null); }}>
              <option value="stdio">stdio（本地进程）</option>
              <option value="http">http（远程服务）</option>
            </select>
          </label>
          <label>
            名称
            <input value={name} onChange={(event) => { setName(event.target.value); setTestResult(null); }} placeholder="例如 filesystem" />
          </label>
          {type === "stdio" ? (
            <>
              <label>
                启动命令
                <input value={command} onChange={(event) => { setCommand(event.target.value); setTestResult(null); }} placeholder="例如 npx" />
              </label>
              <label>
                参数（空格分隔）
                <input value={args} onChange={(event) => { setArgs(event.target.value); setTestResult(null); }} placeholder="例如 -y @modelcontextprotocol/server-filesystem" />
              </label>
            </>
          ) : (
            <label>
              服务地址
              <input value={url} onChange={(event) => { setUrl(event.target.value); setTestResult(null); }} placeholder="例如 https://learn.microsoft.com/api/mcp" />
            </label>
          )}

          <div className="card-actions">
            <button
              type="button"
              className="secondary"
              disabled={!canSubmit || testMutation.isPending}
              onClick={() => testMutation.mutate(buildRequest())}
            >
              {testMutation.isPending ? "测试中…" : "测试连接"}
            </button>
            {testResult && (
              testResult.success
                ? <span className="status-on">✓ 连接成功，发现 {testResult.toolCount} 个工具</span>
                : <span className="status-deny">✗ 连接失败: {testResult.errorMessage}</span>
            )}
          </div>

          <button disabled={!canSubmit || createMutation.isPending} type="submit">
            添加
          </button>
        </form>
      </section>
    </AppShell>
  );
}
