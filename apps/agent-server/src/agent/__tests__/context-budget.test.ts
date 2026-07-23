import { describe, expect, it } from "vitest";
import type { LlmMessage } from "../../llm/llm-types.js";
import { applyContextBudget, ContextBudgetExceededError, estimateTokens, truncateToolResult } from "../context-budget.js";

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
    const result = applyContextBudget([
      { role: "user", content: "old".repeat(1000) },
      { role: "assistant", content: "old answer".repeat(1000) },
      { role: "user", content: "inspect the workspace" },
      ...pair,
    ], 50);

    expect(result.messages.slice(-2)).toEqual(pair);
    expect(result.omittedMessages).toBe(2);
  });

  it("rejects an oversized current message instead of silently truncating it", () => {
    expect(() => applyContextBudget([
      { role: "system", content: "instructions" },
      { role: "user", content: "x".repeat(10_000) },
    ], 100)).toThrow(ContextBudgetExceededError);
  });

  it("counts tool definitions inside the input budget", () => {
    const result = applyContextBudget(
      [{ role: "user", content: "inspect the workspace" }],
      100,
      [{ type: "function", function: { name: "read_file", description: "Read a workspace file", parameters: { type: "object", properties: { path: { type: "string" } } } } }],
    );

    expect(result.toolDefinitionTokens).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBe(result.messageTokens + result.toolDefinitionTokens);
  });
});

describe("truncateToolResult", () => {
  it("truncates oversized tool output and reports the omitted size", () => {
    const content = Array.from({ length: 100 }, (_, index) => `token-${index}`).join(" ");
    const result = truncateToolResult(content, 30);
    expect(result.startsWith("token-0")).toBe(true);
    expect(result).toMatch(/token-99\s*$/);
    expect(result).toContain("tokens omitted");
  });
});