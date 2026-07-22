import { AzureOpenAI } from "openai";
import type {
  FunctionTool,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { LlmProvider } from "./llm-provider.js";
import type { LlmMessage, LlmRequest, LlmResponse, LlmToolDefinition } from "./llm-types.js";

interface AzureOpenAiProviderOptions {
  apiKey: string;
  endpoint: string;
  deployment: string;
  apiVersion: string;
}

export class AzureOpenAiProvider implements LlmProvider {
  readonly #client: AzureOpenAI;
  readonly #deployment: string;

  constructor(options: AzureOpenAiProviderOptions) {
    this.#deployment = options.deployment;
    this.#client = new AzureOpenAI({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      deployment: options.deployment,
      apiVersion: options.apiVersion,
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const input = request.messages.flatMap(toResponseInputItems);

    console.log(`[azure-openai] calling responses.create deployment=${this.#deployment} inputItems=${input.length} tools=${request.tools.length}`);
    try {
      const response = await this.#client.responses.create(
        {
          model: this.#deployment,
          input,
          tools: request.tools.map(toResponseTool),
          tool_choice: "auto",
        },
        { signal: request.signal },
      );
      console.log(`[azure-openai] response received id=${response.id} toolCalls=${response.output.filter((item) => item.type === "function_call").length}`);

      return {
        id: response.id,
        content: response.output_text || null,
        toolCalls: response.output.flatMap((item) =>
          item.type === "function_call"
            ? [{ id: item.call_id, name: item.name, arguments: item.arguments }]
            : [],
        ),
      };
    } catch (error) {
      console.error("[azure-openai] responses.create failed", error);
      throw error;
    }
  }
}

function toResponseTool(tool: LlmToolDefinition): FunctionTool {
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  };
}

function toResponseInputItems(message: LlmMessage): ResponseInputItem[] {
  switch (message.role) {
    case "system":
    case "user":
      return [{ type: "message", role: message.role, content: message.content }];
    case "assistant": {
      const items: ResponseInputItem[] = [];
      if (message.content) items.push({ type: "message", role: "assistant", content: message.content });
      for (const call of message.toolCalls ?? []) {
        items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments });
      }
      return items;
    }
    case "tool":
      return [
        {
          type: "function_call_output",
          call_id: message.toolCallId,
          output: message.content,
        },
      ];
  }
}
