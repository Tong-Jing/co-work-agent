import type { LlmMessage } from "../llm/llm-types.js";

const CHARS_PER_TOKEN = 4;

export interface BudgetedContext {
  messages: LlmMessage[];
  estimatedTokens: number;
  omittedMessages: number;
}

export function applyContextBudget(messages: LlmMessage[], maxTokens: number): BudgetedContext {
  const maxChars = Math.max(1, maxTokens) * CHARS_PER_TOKEN;
  const systemMessages = fitMessages(messages.filter((message) => message.role === "system"), Math.floor(maxChars / 2));
  const segments = groupConversation(messages.filter((message) => message.role !== "system"));
  const selected: LlmMessage[][] = [];
  let usedChars = systemMessages.reduce((total, message) => total + messageSize(message), 0);

  for (const segment of [...segments].reverse()) {
    const size = segment.reduce((total, message) => total + messageSize(message), 0);
    if (usedChars + size > maxChars) {
      if (selected.length === 0) {
        const fitted = fitMessages(segment, maxChars - usedChars);
        if (fitted.length > 0) {
          selected.unshift(fitted);
          usedChars += fitted.reduce((total, message) => total + messageSize(message), 0);
        }
      }
      break;
    }
    selected.unshift(segment);
    usedChars += size;
  }

  const selectedMessages = selected.flat();
  const omittedMessages = messages.length - systemMessages.length - selectedMessages.length;
  const notice = `${omittedMessages} earlier conversation messages were omitted to stay within the context budget.`;
  const omissionNotice: LlmMessage[] = omittedMessages > 0 && usedChars + notice.length <= maxChars
    ? [{ role: "system", content: notice }]
    : [];
  const budgeted = [...systemMessages, ...omissionNotice, ...selectedMessages];

  return {
    messages: budgeted,
    estimatedTokens: estimateTokens(budgeted),
    omittedMessages,
  };
}

export function truncateToolResult(content: string, maxTokens: number): string {
  const maxChars = Math.max(1, maxTokens) * CHARS_PER_TOKEN;
  if (content.length <= maxChars) return content;
  const omittedChars = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n\n[Tool result truncated; ${omittedChars} characters omitted.]`;
}

export function estimateTokens(messages: LlmMessage[]): number {
  const chars = messages.reduce((total, message) => total + messageSize(message), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
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

function messageSize(message: LlmMessage): number {
  if (message.role === "assistant") {
    return (message.content?.length ?? 0)
      + (message.toolCalls ?? []).reduce((total, call) => total + call.name.length + call.arguments.length, 0);
  }
  return message.content.length;
}

function fitMessages(messages: LlmMessage[], maxChars: number): LlmMessage[] {
  const fitted: LlmMessage[] = [];
  let remaining = Math.max(0, maxChars);
  for (const message of messages) {
    if (remaining === 0) break;
    if (message.role === "assistant") {
      const toolCallSize = (message.toolCalls ?? []).reduce((total, call) => total + call.name.length + call.arguments.length, 0);
      if (toolCallSize > remaining) break;
      const content = message.content?.slice(0, remaining - toolCallSize) ?? null;
      const next = { ...message, content };
      fitted.push(next);
      remaining -= messageSize(next);
      continue;
    }
    const next = { ...message, content: message.content.slice(0, remaining) };
    fitted.push(next);
    remaining -= messageSize(next);
  }
  return fitted;
}