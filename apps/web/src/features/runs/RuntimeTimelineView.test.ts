import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@local-agent/contracts";
import { buildRuntime, reasoningSummary } from "./RuntimeTimelineView";

describe("buildRuntime", () => {
  it("groups tool calls under reasoning steps and merges outcomes by callId", () => {
    const events: AgentEvent[] = [
      { type: "run.started", runId: "run-1", sequence: 1 },
      { type: "status", label: "Reasoning (step 1)", sequence: 2 },
      { type: "tool.requested", callId: "call-1", tool: "list_files", source: "local", arguments: "{}", summary: "Calling list_files", sequence: 3 },
      { type: "tool.completed", callId: "call-1", tool: "list_files", result: "README.md", summary: "Listed 1 workspace entry", sequence: 4 },
      { type: "status", label: "Reasoning (step 2)", sequence: 5 },
      { type: "tool.requested", callId: "call-2", tool: "read_file", source: "local", arguments: "{\"path\":\"README.md\"}", summary: "Calling read_file", sequence: 6 },
      { type: "tool.completed", callId: "call-2", tool: "read_file", result: "content", summary: "Read 10 lines from README.md", sequence: 7 },
      { type: "run.completed", sequence: 8 },
    ];

    const entries = buildRuntime(events);
    const steps = entries.filter((entry) => entry.kind === "step");

    expect(steps).toHaveLength(2);
    expect(steps[0]?.tools).toHaveLength(1);
    expect(steps[0]?.tools[0]?.requested.tool).toBe("list_files");
    expect(steps[0]?.tools[0]?.outcome?.type).toBe("tool.completed");
    expect(steps[1]?.tools[0]?.requested.tool).toBe("read_file");
    expect(entries).toHaveLength(4);
  });

  it("keeps approval state on the matching tool call", () => {
    const events: AgentEvent[] = [
      { type: "status", label: "Reasoning (step 1)", sequence: 1 },
      { type: "tool.requested", callId: "call-1", tool: "write_file", source: "local", arguments: "{}", summary: "Calling write_file", sequence: 2 },
      { type: "approval.required", callId: "call-1", tool: "write_file", summary: "Write file", risk: "high", sequence: 3 },
    ];

    const step = buildRuntime(events).find((entry) => entry.kind === "step");
    expect(step?.tools[0]?.approval).toEqual(expect.objectContaining({ callId: "call-1", risk: "high" }));
  });

  it("uses explicit reasoning lifecycle events for model decisions", () => {
    const events: AgentEvent[] = [
      { type: "reasoning.started", iteration: 1, estimatedTokens: 120, omittedMessages: 0, sequence: 1 },
      { type: "reasoning.completed", iteration: 1, decision: "final_response", toolCallCount: 0, sequence: 2 },
      { type: "message.delta", text: "done", sequence: 3 },
      { type: "run.completed", sequence: 4 },
    ];

    const step = buildRuntime(events).find((entry) => entry.kind === "step");
    expect(step).toEqual(expect.objectContaining({ number: 1, completed: expect.objectContaining({ decision: "final_response" }) }));
  });

  it("does not describe an interrupted historical model call as running", () => {
    const events: AgentEvent[] = [
      { type: "run.started", runId: "run-1", sequence: 1 },
      { type: "reasoning.started", iteration: 9, estimatedTokens: 120, omittedMessages: 0, sequence: 2 },
    ];

    const step = buildRuntime(events).find((entry) => entry.kind === "step");
    expect(step?.kind).toBe("step");
    if (!step || step.kind !== "step") throw new Error("Expected reasoning step");
    expect(reasoningSummary(step, "neutral", "interrupted")).toBe("Model call interrupted");
  });
});