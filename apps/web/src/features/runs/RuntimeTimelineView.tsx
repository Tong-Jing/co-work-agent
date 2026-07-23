import { useState } from "react";
import { useAtomValue } from "jotai";
import type { AgentEvent } from "@local-agent/contracts";
import { currentWorkspaceIdAtom } from "../../atoms/workspace-atom";
import { createPermissionRule } from "../../api/client";

interface RuntimeTimelineViewProps {
  events: AgentEvent[];
  runStatus: RuntimeRunStatus;
  onDecision(callId: string, decision: "allow" | "deny"): void;
}

type ToolRequested = Extract<AgentEvent, { type: "tool.requested" }>;
type ToolApproval = Extract<AgentEvent, { type: "approval.required" }>;
type ToolOutcome = Extract<AgentEvent, { type: "tool.completed" | "tool.failed" | "tool.denied" }>;
type ReasoningStarted = Extract<AgentEvent, { type: "reasoning.started" }>;
type ReasoningCompleted = Extract<AgentEvent, { type: "reasoning.completed" }>;
type StandaloneEvent = Exclude<AgentEvent, ToolRequested | ToolApproval | ToolOutcome | ReasoningStarted | ReasoningCompleted | Extract<AgentEvent, { type: "message.delta" }>>;
type StatusTone = "running" | "completed" | "failed" | "approval" | "neutral";
type RuntimeRunStatus = "created" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RuntimeToolCall {
  requested: ToolRequested;
  approval?: ToolApproval;
  outcome?: ToolOutcome;
}

export interface RuntimeStep {
  kind: "step";
  sequence: number;
  number: number;
  tools: RuntimeToolCall[];
  completed?: ReasoningCompleted;
}

export type RuntimeEntry = RuntimeStep | { kind: "tool"; tool: RuntimeToolCall } | { kind: "event"; event: StandaloneEvent };

export function RuntimeTimelineView({ events, runStatus, onDecision }: RuntimeTimelineViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const entries = buildRuntime(events);
  const tools = entries.flatMap((entry) => entry.kind === "step" ? entry.tools : entry.kind === "tool" ? [entry.tool] : []);
  const status = runtimeStatus(events, runStatus);
  const currentStep = entries.findLast((entry): entry is RuntimeStep => entry.kind === "step")?.number;
  const latestStep = entries.findLast((entry): entry is RuntimeStep => entry.kind === "step");

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const rememberRule = async (event: ToolApproval) => {
    if (!workspaceId) return;
    const requested = tools.find((tool) => tool.requested.callId === event.callId)?.requested;
    if (!requested) {
      onDecision(event.callId, "allow");
      return;
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(requested.arguments);
    } catch {
      // Keep empty arguments when a tool emits invalid JSON.
    }

    const draft = suggestRule(args);
    const description = draft.matcher.kind === "path"
      ? "路径模式（可编辑）："
      : `${draft.matcher.field} 允许的值（逗号分隔，可编辑）：`;
    const defaultValue = draft.matcher.kind === "path" ? draft.matcher.pattern : draft.matcher.values.join(", ");
    const input = window.prompt(`记住规则 - ${description}`, defaultValue);
    if (input === null) return;

    const matcher = draft.matcher.kind === "path"
      ? { kind: "path" as const, pattern: input.trim() || draft.matcher.pattern }
      : { kind: "arg" as const, field: draft.matcher.field, values: input.split(",").map((value) => value.trim()).filter(Boolean) };

    try {
      await createPermissionRule({ workspaceId, toolName: requested.tool, matcher, decision: "allow", priority: 10, enabled: true });
    } catch (error) {
      console.error("[run-timeline] failed to create quick permission rule", error);
    }
    onDecision(event.callId, "allow");
  };

  return (
    <section className="timeline" aria-label="Agent runtime">
      <header className="runtime-header">
        <strong>Runtime</strong>
        <span className={`runtime-summary runtime-summary-${status.tone}`}>
          <StatusDot tone={status.tone} active={status.tone === "running"} />
          {status.label}
          {currentStep ? ` · Step ${currentStep}` : ""}
          {tools.length ? ` · ${tools.length} ${tools.length === 1 ? "tool" : "tools"}` : ""}
        </span>
      </header>

      <div className="runtime-track">
        {entries.length === 0 && <p className="muted">No run events yet</p>}
        {entries.map((entry, index) => {
          if (entry.kind === "step") {
            return (
              <RuntimeStepView
                key={`step-${entry.sequence}`}
                step={entry}
                tone={stepTone(entry, entry === latestStep, status.tone)}
                runStatus={runStatus}
                expanded={expanded}
                onToggle={toggle}
                onDecision={onDecision}
                onRemember={rememberRule}
                workspaceAvailable={Boolean(workspaceId)}
              />
            );
          }
          if (entry.kind === "tool") {
            return (
              <ToolCallView
                key={entry.tool.requested.callId}
                tool={entry.tool}
                expanded={expanded.has(`tool-${entry.tool.requested.callId}`)}
                onToggle={() => toggle(`tool-${entry.tool.requested.callId}`)}
                onDecision={onDecision}
                onRemember={rememberRule}
                workspaceAvailable={Boolean(workspaceId)}
              />
            );
          }
          return (
            <RuntimeEventView
              key={`event-${entry.event.sequence}`}
              event={entry.event}
              expanded={expanded.has(`event-${entry.event.sequence}`)}
              onToggle={() => toggle(`event-${entry.event.sequence}`)}
              current={status.tone === "running" && index === entries.length - 1}
            />
          );
        })}
      </div>
    </section>
  );
}

function RuntimeStepView({ step, tone, runStatus, expanded, onToggle, onDecision, onRemember, workspaceAvailable }: {
  step: RuntimeStep;
  tone: StatusTone;
  runStatus: RuntimeRunStatus;
  expanded: Set<string>;
  onToggle(key: string): void;
  onDecision(callId: string, decision: "allow" | "deny"): void;
  onRemember(event: ToolApproval): Promise<void>;
  workspaceAvailable: boolean;
}) {
  return (
    <article className={`runtime-node runtime-step runtime-node-${tone}`}>
      <div className="runtime-node-heading">
        <StatusIcon tone={tone} />
        <strong>Reasoning · Step {step.number}</strong>
      </div>
      <p className="runtime-step-summary">{reasoningSummary(step, tone, runStatus)}</p>
      <div className="runtime-step-tools">
        {step.tools.map((tool) => (
          <ToolCallView
            key={tool.requested.callId}
            tool={tool}
            expanded={expanded.has(`tool-${tool.requested.callId}`)}
            onToggle={() => onToggle(`tool-${tool.requested.callId}`)}
            onDecision={onDecision}
            onRemember={onRemember}
            workspaceAvailable={workspaceAvailable}
          />
        ))}
      </div>
    </article>
  );
}

function ToolCallView({ tool, expanded, onToggle, onDecision, onRemember, workspaceAvailable }: {
  tool: RuntimeToolCall;
  expanded: boolean;
  onToggle(): void;
  onDecision(callId: string, decision: "allow" | "deny"): void;
  onRemember(event: ToolApproval): Promise<void>;
  workspaceAvailable: boolean;
}) {
  const tone = toolTone(tool);
  const details = toolDetails(tool);
  return (
    <div className={`runtime-tool runtime-tool-${tone}`}>
      <button className="runtime-tool-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
        <StatusIcon tone={tone} />
        <span className="runtime-tool-copy">
          <strong>Tool Use · <code>{tool.requested.tool}</code></strong>
          <span>{toolSummary(tool)}</span>
        </span>
        {tool.requested.source === "mcp" && <span className="runtime-source">MCP{tool.requested.mcpServer ? ` · ${tool.requested.mcpServer}` : ""}</span>}
        <ChevronIcon expanded={expanded} />
      </button>

      {tool.approval && !tool.outcome && (
        <div className="runtime-approval">
          <span>Approval Required · {capitalize(tool.approval.risk)} risk</span>
          <div className="actions">
            <button onClick={() => onDecision(tool.approval!.callId, "allow")}>Allow once</button>
            <button className="secondary" disabled={!workspaceAvailable} onClick={() => void onRemember(tool.approval!)}>Allow and remember</button>
            <button className="secondary" onClick={() => onDecision(tool.approval!.callId, "deny")}>Deny</button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="runtime-tool-details">
          <DetailBlock label="INPUT" content={details.input} />
          {details.output && <DetailBlock label={tone === "failed" ? "ERROR" : "OBSERVATION"} content={details.output} />}
        </div>
      )}
    </div>
  );
}

function RuntimeEventView({ event, expanded, onToggle, current }: {
  event: StandaloneEvent;
  expanded: boolean;
  onToggle(): void;
  current: boolean;
}) {
  const details = eventDetails(event);
  const tone = eventTone(event, current);
  return (
    <article className={`runtime-node runtime-node-${tone}`}>
      <div className="runtime-node-heading">
        <StatusIcon tone={tone} />
        <strong>{eventLabel(event)}</strong>
        {details && (
          <button className="event-expand" type="button" aria-label={expanded ? "Hide details" : "View details"} aria-expanded={expanded} onClick={onToggle}>
            <ChevronIcon expanded={expanded} />
          </button>
        )}
      </div>
      {event.type === "context.gathered" && (
        <>
          <p>{plural(event.memoryCount, "memory", "memories")} · {plural(event.skillCount, "skill")} · {plural(event.historyCount, "history message")}</p>
          {event.estimatedTokens !== undefined && event.maxTokens !== undefined && (
            <p>~{formatTokenCount(event.estimatedTokens)} / {formatTokenCount(event.maxTokens)} agent input budget</p>
          )}
          {(event.messageTokens !== undefined || event.toolDefinitionTokens !== undefined || event.maxOutputTokens !== undefined) && (
            <p>
              {event.messageTokens !== undefined ? `Messages ~${formatTokenCount(event.messageTokens)}` : ""}
              {event.toolDefinitionTokens !== undefined ? ` · Tool schema ~${formatTokenCount(event.toolDefinitionTokens)}` : ""}
              {event.maxOutputTokens !== undefined ? ` · Max output ${formatTokenCount(event.maxOutputTokens)}` : ""}
            </p>
          )}
          {(event.omittedMessages ?? 0) > 0 && (
            <p className="runtime-context-warning">{plural(event.omittedMessages!, "earlier message")} omitted by context budget</p>
          )}
        </>
      )}
      {event.type === "workflow.node.failed" && <p>{event.message}</p>}
      {event.type === "run.failed" && <p>{event.message}</p>}
      {details && expanded && <DetailBlock label={event.type === "file.diff" ? "DIFF" : "DETAILS"} content={details} />}
    </article>
  );
}

function DetailBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="runtime-detail-block">
      <span>{label}</span>
      <pre className="event-details">{content}</pre>
    </div>
  );
}

export function buildRuntime(events: AgentEvent[]): RuntimeEntry[] {
  const entries: RuntimeEntry[] = [];
  const toolCalls = new Map<string, RuntimeToolCall>();
  const reasoningSteps = new Map<number, RuntimeStep>();
  let currentStep: RuntimeStep | null = null;

  for (const event of events) {
    if (event.type === "message.delta") continue;
    if (event.type === "reasoning.started") {
      currentStep = { kind: "step", sequence: event.sequence, number: event.iteration, tools: [] };
      reasoningSteps.set(event.iteration, currentStep);
      entries.push(currentStep);
      continue;
    }
    if (event.type === "reasoning.completed") {
      const step = reasoningSteps.get(event.iteration);
      if (step) step.completed = event;
      continue;
    }
    if (event.type === "status") {
      const match = /Reasoning\s*\(step\s+(\d+)\)/i.exec(event.label);
      if (match) {
        currentStep = { kind: "step", sequence: event.sequence, number: Number(match[1]), tools: [] };
        reasoningSteps.set(currentStep.number, currentStep);
        entries.push(currentStep);
      } else {
        entries.push({ kind: "event", event });
      }
      continue;
    }
    if (event.type === "tool.requested") {
      const tool: RuntimeToolCall = { requested: event };
      toolCalls.set(event.callId, tool);
      if (currentStep) currentStep.tools.push(tool);
      else entries.push({ kind: "tool", tool });
      continue;
    }
    if (event.type === "approval.required") {
      const tool = toolCalls.get(event.callId);
      if (tool) tool.approval = event;
      continue;
    }
    if (event.type === "tool.completed" || event.type === "tool.failed" || event.type === "tool.denied") {
      const tool = toolCalls.get(event.callId);
      if (tool) tool.outcome = event;
      continue;
    }
    entries.push({ kind: "event", event });
  }
  return entries;
}

function runtimeStatus(events: AgentEvent[], runStatus: RuntimeRunStatus) {
  const terminal = events.findLast((event) => event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled");
  if (terminal?.type === "run.completed") return { label: "Completed", tone: "completed" as const };
  if (terminal?.type === "run.failed") return { label: "Failed", tone: "failed" as const };
  if (terminal?.type === "run.cancelled") return { label: "Cancelled", tone: "neutral" as const };
  if (runStatus === "completed") return { label: "Completed", tone: "completed" as const };
  if (runStatus === "failed") return { label: "Failed", tone: "failed" as const };
  if (runStatus === "cancelled") return { label: "Cancelled", tone: "neutral" as const };
  if (runStatus === "interrupted") return { label: "Interrupted", tone: "neutral" as const };
  const waiting = events.some((event) => event.type === "approval.required" && !events.some((candidate) =>
    "callId" in candidate && candidate.callId === event.callId && (candidate.type === "tool.completed" || candidate.type === "tool.failed" || candidate.type === "tool.denied"),
  ));
  return waiting ? { label: "Waiting for approval", tone: "approval" as const } : { label: "Running", tone: "running" as const };
}

function toolTone(tool: RuntimeToolCall): StatusTone {
  if (tool.outcome?.type === "tool.completed") return "completed";
  if (tool.outcome?.type === "tool.failed") return "failed";
  if (tool.outcome?.type === "tool.denied") return "neutral";
  if (tool.approval) return "approval";
  return "running";
}

function stepTone(step: RuntimeStep, latest: boolean, runTone: StatusTone): StatusTone {
  if (latest && runTone === "failed") return "failed";
  if (step.tools.some((tool) => tool.approval && !tool.outcome)) return "approval";
  if (latest && runTone === "running" && (!step.completed || step.tools.some((tool) => !tool.outcome))) return "running";
  return "completed";
}

function toolSummary(tool: RuntimeToolCall) {
  if (tool.outcome?.type === "tool.completed" || tool.outcome?.type === "tool.failed") return `Observation · ${tool.outcome.summary}`;
  if (tool.outcome?.type === "tool.denied") return `Observation · ${tool.outcome.reason}`;
  if (tool.approval) return tool.approval.summary;
  return tool.requested.summary;
}

function toolDetails(tool: RuntimeToolCall) {
  let input = tool.requested.arguments;
  try {
    input = JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    // Keep the original serialized input.
  }
  const output = tool.outcome?.type === "tool.completed"
    ? tool.outcome.result
    : tool.outcome?.type === "tool.failed"
      ? tool.outcome.error
      : tool.outcome?.type === "tool.denied"
        ? tool.outcome.reason
        : null;
  return { input, output };
}

function eventLabel(event: StandaloneEvent) {
  switch (event.type) {
    case "run.started": return "Run Started";
    case "context.gathered": return "Context Gathered";
    case "status": return event.label;
    case "workflow.node.started": return `Workflow Node Started · ${event.label}`;
    case "workflow.node.completed": return `Workflow Node Completed · ${event.label}`;
    case "workflow.node.failed": return `Workflow Node Failed · ${event.label}`;
    case "workflow.node.waiting-input": return `Workflow Node Waiting for Input · ${event.label}`;
    case "file.diff": return `File Diff · ${event.path}`;
    case "run.completed": return "Run Completed";
    case "run.cancelled": return "Run Cancelled";
    case "run.failed": return "Run Failed";
  }
}

export function reasoningSummary(step: RuntimeStep, tone: StatusTone, runStatus: RuntimeRunStatus) {
  if (step.completed?.decision === "final_response") return "Final response generated";
  if (step.completed?.decision === "tool_calls") return `Model requested ${plural(step.completed.toolCallCount, "tool call")}`;
  if (step.tools.length > 0) return `Model requested ${plural(step.tools.length, "tool call")}`;
  if (tone === "running") return "Calling model…";
  if (runStatus === "interrupted") return "Model call interrupted";
  if (runStatus === "failed") return "Model call failed";
  if (runStatus === "cancelled") return "Model call cancelled";
  return "Model call completed";
}

function eventDetails(event: StandaloneEvent) {
  return event.type === "file.diff" ? event.patch : null;
}

function eventTone(event: StandaloneEvent, current: boolean): StatusTone {
  if (event.type === "run.failed" || event.type === "workflow.node.failed") return "failed";
  if (event.type === "workflow.node.waiting-input") return "approval";
  if (event.type === "run.cancelled") return "neutral";
  if (current && event.type !== "run.completed") return "running";
  return "completed";
}

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "completed") return <span className="runtime-status-icon" aria-label="Completed">✓</span>;
  if (tone === "failed") return <span className="runtime-status-icon" aria-label="Failed">×</span>;
  if (tone === "neutral") return <span className="runtime-status-icon" aria-label="Stopped">−</span>;
  if (tone === "approval") return <span className="runtime-status-icon" aria-label="Approval required">!</span>;
  return <span className="runtime-status-icon runtime-status-active" aria-label="Running">●</span>;
}

function StatusDot({ tone, active }: { tone: StatusTone; active?: boolean }) {
  return <span className={`runtime-dot runtime-dot-${tone} ${active ? "runtime-dot-active" : ""}`} aria-hidden="true" />;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatTokenCount(tokens: number) {
  if (tokens < 1_000) return tokens.toLocaleString();
  const thousands = tokens / 1_000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function suggestRule(args: Record<string, unknown>) {
  const path = typeof args.path === "string" ? args.path : null;
  if (path) {
    const lastSlash = path.lastIndexOf("/");
    const directory = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
    return { matcher: { kind: "path" as const, pattern: directory ? `${directory}/**` : "**" } };
  }
  const [field, value] = Object.entries(args).find(([, candidate]) => typeof candidate === "string") ?? ["value", ""];
  return { matcher: { kind: "arg" as const, field, values: value ? [String(value)] : [] } };
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="runtime-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none" }} aria-hidden="true">
      <path d="M5 7.5L10 12.5L15 7.5" />
    </svg>
  );
}
