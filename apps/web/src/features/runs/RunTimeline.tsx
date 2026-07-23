import { useState } from "react";
import { useAtomValue } from "jotai";
import type { AgentEvent } from "@local-agent/contracts";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import { createPermissionRule } from "../../api/client";

interface RunTimelineProps {
  events: AgentEvent[];
  onDecision(callId: string, decision: "allow" | "deny"): void;
}

export function RunTimeline({ events, onDecision }: RunTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);

  const toggle = (sequence: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(sequence)) next.delete(sequence);
      else next.add(sequence);
      return next;
    });
  };

  const rememberRule = async (event: Extract<AgentEvent, { type: "approval.required" }>) => {
    if (!workspaceId) return;
    const requested = events.find((item): item is Extract<AgentEvent, { type: "tool.requested" }> =>
      item.type === "tool.requested" && item.callId === event.callId,
    );
    if (!requested) {
      onDecision(event.callId, "allow");
      return;
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(requested.arguments);
    } catch {
      // fall through with empty args
    }

    const draft = suggestRule(requested.tool, args);
    const description = draft.matcher.kind === "path"
      ? `路径模式（可编辑）：`
      : `${draft.matcher.field} 允许的值（逗号分隔，可编辑）：`;
    const defaultValue = draft.matcher.kind === "path" ? draft.matcher.pattern : draft.matcher.values.join(", ");
    const input = window.prompt(`记住规则 - ${description}`, defaultValue);
    if (input === null) return; // user cancelled the whole thing

    const matcher = draft.matcher.kind === "path"
      ? { kind: "path" as const, pattern: input.trim() || draft.matcher.pattern }
      : { kind: "arg" as const, field: draft.matcher.field, values: input.split(",").map((v) => v.trim()).filter(Boolean) };

    try {
      await createPermissionRule({ workspaceId, toolName: requested.tool, matcher, decision: "allow", priority: 10, enabled: true });
    } catch (error) {
      console.error("[run-timeline] failed to create quick permission rule", error);
    }
    onDecision(event.callId, "allow");
  };

  return (
    <section className="timeline" aria-label="Agent progress">
      {events.length === 0 && <p className="muted">No run events yet</p>}
      {events.map((event) => {
        const details = detailsFor(event);
        const isExpanded = expanded.has(event.sequence);
        return (
          <article className={`event event-${event.type.replaceAll(".", "-")}`} key={event.sequence}>
            <div className="event-row">
              <strong>{labelFor(event)}</strong>
              {details && (
                <button
                  className="event-expand"
                  type="button"
                  aria-label={isExpanded ? "收起详情" : "查看详情"}
                  aria-expanded={isExpanded}
                  onClick={() => toggle(event.sequence)}
                >
                  <ChevronIcon expanded={isExpanded} />
                </button>
              )}
            </div>
            {event.type === "context.gathered" && (
              <p>{event.memoryCount} memory · {event.skillCount} skill · {event.historyCount} history messages</p>
            )}
            {event.type === "tool.requested" && <p>{event.summary}</p>}
            {event.type === "tool.completed" && <p>{event.summary}</p>}
            {event.type === "tool.failed" && <p>{event.summary}</p>}
            {event.type === "tool.denied" && <p>{event.reason}</p>}
            {event.type === "run.failed" && <p>{event.message}</p>}
            {event.type === "approval.required" && (
              <>
                <p>{event.summary}</p>
                <div className="actions">
                  <button onClick={() => onDecision(event.callId, "allow")}>允许一次</button>
                  <button className="secondary" onClick={() => onDecision(event.callId, "deny")}>拒绝</button>
                  <button className="secondary" disabled={!workspaceId} onClick={() => void rememberRule(event)}>
                    允许并记住规则
                  </button>
                </div>
              </>
            )}
            {details && isExpanded && <pre className="event-details">{details}</pre>}
          </article>
        );
      })}
    </section>
  );
}

function suggestRule(toolName: string, args: Record<string, unknown>) {
  const path = typeof args.path === "string" ? args.path : null;
  if (path) {
    const lastSlash = path.lastIndexOf("/");
    const directory = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
    return { matcher: { kind: "path" as const, pattern: directory ? `${directory}/**` : "**" } };
  }

  const [field, value] = Object.entries(args).find(([, v]) => typeof v === "string") ?? ["value", ""];
  return { matcher: { kind: "arg" as const, field, values: value ? [String(value)] : [] } };
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
      aria-hidden="true"
    >
      <path d="M5 7.5L10 12.5L15 7.5" />
    </svg>
  );
}

function labelFor(event: AgentEvent) {
  switch (event.type) {
    case "run.started": return "Run Started";
    case "context.gathered": return "Context Gathered";
    case "status": return event.label;
    case "message.delta": return "Final Response";
    case "tool.requested": return event.source === "mcp" ? `Tool Use (MCP) · ${event.tool}` : `Tool Use · ${event.tool}`;
    case "approval.required": return `Approval Required · ${event.tool}`;
    case "tool.completed": return `Tool Result · ${event.tool}`;
    case "tool.failed": return `Tool Failed · ${event.tool}`;
    case "tool.denied": return `Tool Denied · ${event.tool}`;
    case "file.diff": return `File Diff · ${event.path}`;
    case "run.completed": return "Run Completed";
    case "run.cancelled": return "Run Cancelled";
    case "run.failed": return "Run Failed";
  }
}

function detailsFor(event: AgentEvent): string | null {
  if (event.type === "tool.requested") {
    try {
      return JSON.stringify(JSON.parse(event.arguments), null, 2);
    } catch {
      return event.arguments;
    }
  }
  if (event.type === "tool.completed") return event.result;
  if (event.type === "tool.failed") return event.error;
  if (event.type === "file.diff") return event.patch;
  return null;
}
