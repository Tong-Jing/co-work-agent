import { decode, encode } from "gpt-tokenizer/encoding/o200k_base";
import type { LlmMessage, LlmToolDefinition } from "../llm/llm-types.js";

const MESSAGE_OVERHEAD_TOKENS = 4;

export interface BudgetedContext {
  messages: LlmMessage[];
  estimatedTokens: number;
  messageTokens: number;
  toolDefinitionTokens: number;
  omittedMessages: number;
}

export class ContextBudgetExceededError extends Error {
  constructor(readonly requiredTokens: number, readonly maxTokens: number) {
    super(`Current request requires approximately ${requiredTokens.toLocaleString()} input tokens, exceeding the ${maxTokens.toLocaleString()} token agent input budget. Shorten the request or reduce attached context.`);
    this.name = "ContextBudgetExceededError";
  }
}

export function applyContextBudget(messages: LlmMessage[], maxTokens: number, tools: LlmToolDefinition[] = []): BudgetedContext {
  const inputBudget = Math.max(1, maxTokens);
  const toolDefinitionTokens = estimateToolDefinitionTokens(tools);
  const messageBudget = inputBudget - toolDefinitionTokens;
  if (messageBudget <= 0) throw new ContextBudgetExceededError(toolDefinitionTokens, inputBudget);

  const systemMessages = fitMessages(
    messages.filter((message) => message.role === "system"),
    Math.floor(messageBudget / 2),
    true,
  );
  const segments = groupConversation(messages.filter((message) => message.role !== "system"));
  const latestUserSegment = segments.findLastIndex((segment) => segment.some((message) => message.role === "user"));
  const requiredStart = latestUserSegment >= 0 ? latestUserSegment : Math.max(0, segments.length - 1);
  const requiredSegments = segments.slice(requiredStart);
  const requiredTokens = estimateTokens(systemMessages) + estimateTokens(requiredSegments.flat());
  if (requiredTokens > messageBudget) {
    throw new ContextBudgetExceededError(requiredTokens + toolDefinitionTokens, inputBudget);
  }

  const selected = [...requiredSegments];
  let usedTokens = requiredTokens;
  for (let index = requiredStart - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const size = estimateTokens(segment);
    if (usedTokens + size > messageBudget) break;
    selected.unshift(segment);
    usedTokens += size;
  }

  const selectedMessages = selected.flat();
  const omittedMessages = messages.length - systemMessages.length - selectedMessages.length;
  const notice: LlmMessage = { role: "system", content: `${omittedMessages} earlier conversation messages were omitted to stay within the context budget.` };
  const omissionNotice = omittedMessages > 0 && usedTokens + estimateTokens([notice]) <= messageBudget ? [notice] : [];
  const budgeted = [...systemMessages, ...omissionNotice, ...selectedMessages];
  const messageTokens = estimateTokens(budgeted);

  return {
    messages: budgeted,
    estimatedTokens: messageTokens + toolDefinitionTokens,
    messageTokens,
    toolDefinitionTokens,
    omittedMessages,
  };
}

export function truncateToolResult(content: string, maxTokens: number): string {
  const tokens = encode(content);
  const budget = Math.max(1, maxTokens);
  if (tokens.length <= budget) return content;

  const marker = `\n\n[Tool result truncated; ${tokens.length - budget} tokens omitted.]\n\n`;
  const markerTokens = encode(marker);
  const contentBudget = Math.max(1, budget - markerTokens.length);
  const headSize = Math.ceil(contentBudget * 0.6);
  const tailSize = contentBudget - headSize;
  return `${decode(tokens.slice(0, headSize))}${marker}${tailSize > 0 ? decode(tokens.slice(-tailSize)) : ""}`;
}

export function estimateTokens(messages: LlmMessage[]): number {
  return messages.reduce((total, message) => total + messageTokens(message), 0);
}

export function estimateToolDefinitionTokens(tools: LlmToolDefinition[]): number {
  if (tools.length === 0) return 0;
  return encode(JSON.stringify(tools)).length + MESSAGE_OVERHEAD_TOKENS;
}

function groupConversation(messages: LlmMessage[]): LlmMessage[][] {
  const segments: LlmMessage[][] = [];
  for (const message of messages) {
    if (message.role === "tool" && segments.at(-1)?.[0]?.role === "assistant") {
      segments.at(-1)!.push(message);
    } else {
      segments.push([message]);
    }
  }
  return segments;
}

function messageTokens(message: LlmMessage): number {
  if (message.role === "assistant") {
    return MESSAGE_OVERHEAD_TOKENS
      + countText(message.content ?? "")
      + (message.toolCalls ?? []).reduce((total, call) => total + countText(call.id) + countText(call.name) + countText(call.arguments), 0);
  }
  if (message.role === "tool") {
    return MESSAGE_OVERHEAD_TOKENS + countText(message.toolCallId) + countText(message.content);
  }
  return MESSAGE_OVERHEAD_TOKENS + countText(message.role) + countText(message.content);
}

function fitMessages(messages: LlmMessage[], maxTokens: number, markTruncation = false): LlmMessage[] {
  const fitted: LlmMessage[] = [];
  let remaining = Math.max(0, maxTokens);
  for (const message of messages) {
    const size = messageTokens(message);
    if (size <= remaining) {
      fitted.push(message);
      remaining -= size;
      continue;
    }
    if (message.role === "assistant" || remaining <= MESSAGE_OVERHEAD_TOKENS) break;
    const prefix = markTruncation ? "[Context truncated to fit agent input budget.]\n\n" : "";
    const available = Math.max(0, remaining - MESSAGE_OVERHEAD_TOKENS - countText(message.role) - countText(prefix));
    const content = decode(encode(message.content).slice(0, available));
    fitted.push({ ...message, content: `${prefix}${content}` });
    break;
  }
  return fitted;
}

function countText(content: string) {
  return encode(content).length;
}
