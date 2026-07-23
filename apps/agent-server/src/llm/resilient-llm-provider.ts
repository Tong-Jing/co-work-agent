import type { LlmProvider } from "./llm-provider.js";
import type { LlmRequest, LlmResponse } from "./llm-types.js";

interface ResilientLlmOptions {
  modelTimeoutMs: number;
  maxRetries: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerCooldownMs: number;
}

export class ResilientLlmProvider implements LlmProvider {
  #consecutiveFailures = 0;
  #circuitOpenedAt: number | null = null;

  constructor(
    private readonly inner: LlmProvider,
    private readonly options: ResilientLlmOptions,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (this.isCircuitOpen()) throw new Error("LLM circuit breaker is open");

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const response = await withModelTimeout(this.inner, request, this.options.modelTimeoutMs);
        this.#consecutiveFailures = 0;
        this.#circuitOpenedAt = null;
        return response;
      } catch (error) {
        if (request.signal.aborted) throw request.signal.reason ?? error;
        const transient = isTransientLlmError(error);
        if (transient && attempt < this.options.maxRetries) {
          await abortableDelay(100 * 2 ** attempt, request.signal);
          continue;
        }
        if (transient) this.recordFailure();
        throw error;
      }
    }

    throw new Error("LLM request failed");
  }

  private isCircuitOpen() {
    if (this.#circuitOpenedAt === null) return false;
    if (Date.now() - this.#circuitOpenedAt >= this.options.circuitBreakerCooldownMs) {
      this.#consecutiveFailures = 0;
      this.#circuitOpenedAt = null;
      return false;
    }
    return true;
  }

  private recordFailure() {
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.options.circuitBreakerFailureThreshold) {
      this.#circuitOpenedAt = Date.now();
    }
  }
}

class ModelTimeoutError extends Error {
  override name = "ModelTimeoutError";
}

async function withModelTimeout(provider: LlmProvider, request: LlmRequest, timeoutMs: number) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new ModelTimeoutError(`Model request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const signal = AbortSignal.any([request.signal, timeoutController.signal]);
  try {
    return await Promise.race([
      provider.complete({ ...request, signal }),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientLlmError(error: unknown) {
  if (error instanceof ModelTimeoutError) return true;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code)
    || status === 408
    || status === 429
    || status >= 500;
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}