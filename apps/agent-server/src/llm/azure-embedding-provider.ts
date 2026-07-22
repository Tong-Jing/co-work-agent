import { AzureOpenAI } from "openai";
import type { EmbeddingProvider } from "./embedding-provider.js";

interface AzureEmbeddingProviderOptions {
  apiKey: string;
  endpoint: string;
  deployment: string;
  apiVersion: string;
}

export class AzureEmbeddingProvider implements EmbeddingProvider {
  readonly #client: AzureOpenAI;
  readonly #deployment: string;

  constructor(options: AzureEmbeddingProviderOptions) {
    this.#deployment = options.deployment;
    this.#client = new AzureOpenAI({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      deployment: options.deployment,
      apiVersion: options.apiVersion,
    });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.#client.embeddings.create({ model: this.#deployment, input: text });
    const embedding = response.data[0]?.embedding;
    if (!embedding) throw new Error("Embedding response contained no data");
    return embedding;
  }
}
