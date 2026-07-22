export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export interface LlmRequest {
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  signal: AbortSignal;
}

export interface LlmResponse {
  id: string;
  content: string | null;
  toolCalls: LlmToolCall[];
}
