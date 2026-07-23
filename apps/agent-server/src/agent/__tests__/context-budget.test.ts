import { describe, expect, it } from "vitest";
import type { LlmMessage } from "../../llm/llm-types.js";
import { applyContextBudget, estimateTokens, truncateToolResult } from "../context-budget.js";

describe("applyContextBudget", () => {
  it("keeps system instructions and recent messages while dropping old history", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "old".repeat(100) },
      { role: "assistant", content: "old answer".repeat(100) },
      { role: "user", content: "latest question" },
    ];

    const result = applyContextBudget(messages, 20);

    expect(result.messages[0]).toEqual({ role: "system", content: "system" });
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "latest question" });
    expect(result.omittedMessages).toBe(2);
  });

  it("keeps assistant tool calls paired with their tool results", () => {
    const pair: LlmMessage[] = [
      { role: "assistant", content: null, toolCalls: [{ id: "call-1", name: "read_file", arguments: "{}" }] },
      { role: "tool", toolCallId: "call-1", content: "result" },
    ];
    const result = applyContextBudget([{ role: "user", content: "x".repeat(1000) }, ...pair], 20);

    expect(result.messages.slice(-2)).toEqual(pair);
  });

  it("truncates a single oversized current message to the configured budget", () => {
    const result = applyContextBudget([
      { role: "system", content: "instructions" },
      { role: "user", content: "x".repeat(10_000) },
    ], 100);

    expect(estimateTokens(result.messages)).toBeLessThanOrEqual(100);
    const latest = result.messages.at(-1);
    expect(latest?.role).toBe("user");
    expect(latest?.role === "user" ? latest.content.length : 10_000).toBeLessThan(10_000);
  });
});

describe("truncateToolResult", () => {
  it("truncates oversized tool output and reports the omitted size", () => {
    const result = truncateToolResult("x".repeat(100), 10);
    expect(result).toContain("x".repeat(40));
    expect(result).toContain("60 characters omitted");
  });
});