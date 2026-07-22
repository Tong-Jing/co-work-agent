import type { LlmRequest, LlmResponse } from "./llm-types.js";

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
