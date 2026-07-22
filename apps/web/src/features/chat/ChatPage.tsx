import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { currentSessionIdAtom } from "../../atoms/current-session-atom";
import { activeRunAtom, appendRunEventAtom } from "../../atoms/run-atoms";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import {
  cancelRun,
  createSession,
  decideToolCall,
  getSession,
  getWorkflowRunBySession,
  resumeWorkflowRun,
  sendMessage,
  subscribeToRun,
} from "../../api/client";
import { AppShell } from "../shell/AppShell";
import { RunTimeline } from "../runs/RunTimeline";

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3L3 9.5l6 2.5 2 6L17 3z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="12" height="12" rx="2" />
    </svg>
  );
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const [currentSessionId, setCurrentSessionId] = useAtom(currentSessionIdAtom);
  const [input, setInput] = useState("");
  const [activeRun, setActiveRun] = useAtom(activeRunAtom);
  const appendEvent = useSetAtom(appendRunEventAtom);

  const session = useQuery({
    queryKey: ["session", currentSessionId],
    queryFn: () => getSession(currentSessionId!),
    enabled: Boolean(currentSessionId),
  });

  const workflowRun = useQuery({
    queryKey: ["workflow-run-by-session", currentSessionId],
    queryFn: () => getWorkflowRunBySession(currentSessionId!),
    enabled: Boolean(currentSessionId),
    refetchInterval: (query) => {
      if (query.state.data === null) return false;
      const status = query.state.data?.status;
      return status === "waiting-input" || status === "completed" || status === "failed" || status === "cancelled" ? false : 3000;
    },
  });
  const isWorkflowRunning = workflowRun.data?.status === "running";
  const isWaitingForWorkflowInput = workflowRun.data?.status === "waiting-input";

  // Workflow steps run outside the SSE-driven activeRun/subscribeToRun path, so while a workflow
  // is progressing (not yet paused for input or finished) we poll the session transcript directly
  // to surface newly-written messages and tool timelines as they happen.
  useEffect(() => {
    if (!isWorkflowRunning) return;
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["session", currentSessionId] });
    }, 3000);
    return () => clearInterval(interval);
  }, [isWorkflowRunning, currentSessionId, queryClient]);

  const resumeMutation = useMutation({
    mutationFn: (answer: string) => resumeWorkflowRun(workflowRun.data!.id, answer),
    onSuccess: async () => {
      setInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session", currentSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-run-by-session", currentSessionId] }),
        queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] }),
      ]);
    },
    onError: (error) => console.error("[chat] resume workflow failed", error),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      let sessionId = currentSessionId;
      if (!sessionId) {
        if (!workspaceId) throw new Error("请先选择或创建一个 workspace");
        const created = await createSession(workspaceId);
        sessionId = created.id;
        setCurrentSessionId(sessionId);
      }
      return { sessionId, ...(await sendMessage(sessionId, input)) };
    },
    onSuccess: async ({ sessionId, runId }) => {
      setInput("");
      setActiveRun({ runId, status: "running", response: "", events: [] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] }),
      ]);
    },
    onError: (error) => {
      console.error("[chat] sendMessage failed", error);
    },
  });

  useEffect(() => {
    if (!activeRun.runId) return;
    return subscribeToRun(
      activeRun.runId,
      (event) => {
        appendEvent(event);
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) {
          void queryClient.invalidateQueries({ queryKey: ["session", currentSessionId] });
          void queryClient.invalidateQueries({ queryKey: ["sessions", workspaceId] });
        }
      },
      () => {
        console.error(`[chat] SSE connection failed runId=${activeRun.runId}`);
        setActiveRun((current) => current.status === "running" ? { ...current, status: "failed" } : current);
      },
    );
  }, [activeRun.runId, appendEvent, currentSessionId, queryClient, setActiveRun, workspaceId]);

  const isRunning = activeRun.status === "running" || activeRun.status === "waiting-approval" || isWorkflowRunning;
  const sendError = sendMutation.isError
    ? sendMutation.error instanceof Error ? sendMutation.error.message : "发送失败"
    : null;

  const submitComposer = () => {
    if (!input.trim()) return;
    if (isWaitingForWorkflowInput) {
      if (!resumeMutation.isPending) resumeMutation.mutate(input.trim());
      return;
    }
    if (!isRunning) sendMutation.mutate();
  };

  return (
    <AppShell>
      <section className="chat">
        <div className="messages">
          {(() => {
            const messages = session.data?.messages ?? [];
            const persistedRuns = session.data?.runs ?? [];
            const renderedRunIds = new Set<string>();
            return messages.map((message) => {
              const isActiveRun = message.runId !== null && message.runId === activeRun.runId;
              const persisted = message.runId
                ? persistedRuns.find((run) => run.runId === message.runId)
                : undefined;
              const events = isActiveRun ? activeRun.events : persisted?.events ?? [];
              const showTimeline = message.runId !== null && !renderedRunIds.has(message.runId) && events.length > 0;
              if (message.runId !== null) renderedRunIds.add(message.runId);

              return (
                <div key={message.id}>
                  <MessageBubble role={message.role} content={message.content} />
                  {showTimeline && (
                    <RunTimeline
                      events={events}
                      onDecision={(callId, decision) => void decideToolCall(callId, decision)}
                    />
                  )}
                </div>
              );
            });
          })()}
          {!currentSessionId && <div className="empty"><h2>开始一个本地代码任务</h2><p>Agent 只在已配置工作区内读取文件，写操作与提交需要批准。</p></div>}
          {isRunning && activeRun.response && (
            <article className="message assistant streaming">
              <span>Agent</span>
              <ReactMarkdown>{activeRun.response}</ReactMarkdown>
            </article>
          )}
          {activeRun.status === "failed" && (
            <div className="error-banner">任务失败，请检查后端日志或重试。</div>
          )}
          {isWaitingForWorkflowInput && (
            <div className="workflow-waiting-banner">Workflow 正在等待你的回复，请在下方输入框回答后发送。</div>
          )}
        </div>

        <form onSubmit={(event) => { event.preventDefault(); submitComposer(); }}>
          {sendError && <div className="error-banner">发送失败：{sendError}</div>}
          <div className="composer-box">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitComposer();
                }
              }}
              placeholder={isWaitingForWorkflowInput ? "回答 Workflow 的提问…" : isWorkflowRunning ? "Workflow 正在执行，请稍候…" : "描述要分析或修改的任务…"}
              disabled={isWorkflowRunning && !isWaitingForWorkflowInput}
            />
            <div className="composer-actions">
              {isRunning && activeRun.runId ? (
                <button
                  className="icon-button secondary"
                  type="button"
                  aria-label="停止"
                  onClick={() => void cancelRun(activeRun.runId!)}
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  className="icon-button"
                  disabled={!input.trim() || sendMutation.isPending || resumeMutation.isPending || (isWorkflowRunning && !isWaitingForWorkflowInput)}
                  type="submit"
                  aria-label="发送"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
    </AppShell>
  );
}

const LONG_MESSAGE_THRESHOLD = 600;

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > LONG_MESSAGE_THRESHOLD;
  const displayContent = isLong && !expanded ? `${content.slice(0, LONG_MESSAGE_THRESHOLD)}…` : content;

  return (
    <article className={`message ${role}`}>
      <span>{role === "user" ? "你" : "Agent"}</span>
      <ReactMarkdown>{displayContent}</ReactMarkdown>
      {isLong && (
        <button type="button" className="secondary message-expand-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "收起" : "展开全文"}
        </button>
      )}
    </article>
  );
}
