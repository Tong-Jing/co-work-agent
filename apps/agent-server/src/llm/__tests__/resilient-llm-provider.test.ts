import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "../llm-provider.js";
import type { LlmResponse } from "../llm-types.js";
import { ResilientLlmProvider } from "../resilient-llm-provider.js";

const request = {
  messages: [{ role: "user" as const, content: "hello" }],
  tools: [],
  maxOutputTokens: 1_024,
  signal: new AbortController().signal,
};

function options(overrides: Partial<ConstructorParameters<typeof ResilientLlmProvider>[1]> = {}) {
  return {
    modelTimeoutMs: 20,
    maxRetries: 2,
    circuitBreakerFailureThreshold: 2,
    circuitBreakerCooldownMs: 10_000,
    ...overrides,
  };
}

describe("ResilientLlmProvider", () => {
  it("retries transient failures and returns the later response", async () => {
    let calls = 0;
    const inner: LlmProvider = {
      complete: vi.fn(async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error("rate limited"), { status: 429 });
        return { id: "ok", content: "done", toolCalls: [] };
      }),
    };
    const provider = new ResilientLlmProvider(inner, options());
    expect(await provider.complete(request)).toEqual(expect.objectContaining({ content: "done" }));
    expect(inner.complete).toHaveBeenCalledTimes(3);
  });

  it("times out a provider that ignores abort signals", async () => {
    const inner: LlmProvider = { complete: vi.fn(() => new Promise<LlmResponse>(() => {})) };
    const provider = new ResilientLlmProvider(inner, options({ maxRetries: 0 }));
    await expect(provider.complete(request)).rejects.toThrow("timed out");
  });

  it("opens the circuit after consecutive transient failures", async () => {
    const inner: LlmProvider = { complete: vi.fn(async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); }) };
    const provider = new ResilientLlmProvider(inner, options({ maxRetries: 0 }));
    await expect(provider.complete(request)).rejects.toThrow("unavailable");
    await expect(provider.complete(request)).rejects.toThrow("unavailable");
    await expect(provider.complete(request)).rejects.toThrow("circuit breaker is open");
    expect(inner.complete).toHaveBeenCalledTimes(2);
  });
});