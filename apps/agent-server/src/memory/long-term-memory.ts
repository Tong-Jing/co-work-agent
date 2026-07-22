import type { MemoryEntry } from "@local-agent/contracts";
import type { EmbeddingProvider } from "../llm/embedding-provider.js";
import type { LlmProvider } from "../llm/llm-provider.js";
import type { MemoryRepository, LongTermMemoryItem } from "./memory-repository.js";
import { cosineSimilarity, recencyDecay } from "./similarity.js";

const RELEVANCE_WEIGHT = 0.7;
const RECENCY_WEIGHT = 0.3;
const CONFLICT_CANDIDATE_THRESHOLD = 0.75;

export class LongTermMemory {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly llm: LlmProvider,
  ) {}

  async remember(workspaceId: string, category: string, content: string): Promise<void> {
    await this.rememberAndReturn(workspaceId, category, content);
  }

  async rememberAndReturn(workspaceId: string, category: string, content: string): Promise<MemoryEntry> {
    const embedding = await this.embeddings.embed(content).catch(() => null);
    const entry = this.repository.addFromRequest({ workspaceId, category, content, embedding });

    if (embedding) await this.detectAndResolveConflicts(workspaceId, entry.id, content, embedding);
    return entry;
  }

  async recall(workspaceId: string, query: string, limit = 8): Promise<LongTermMemoryItem[]> {
    const candidates = this.repository.listActiveForWorkspace(workspaceId);
    if (candidates.length === 0) return [];

    const queryEmbedding = await this.embeddings.embed(query).catch(() => null);
    if (!queryEmbedding) {
      const recent = [...candidates]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
      this.repository.recordRecall(recent.map((item) => item.id));
      return recent;
    }

    const ranked = candidates
      .map((item) => ({
        item,
        score: item.embedding
          ? cosineSimilarity(queryEmbedding, item.embedding) * RELEVANCE_WEIGHT + recencyDecay(item.createdAt) * RECENCY_WEIGHT
          : recencyDecay(item.createdAt) * RECENCY_WEIGHT,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item }) => item);

    this.repository.recordRecall(ranked.map((item) => item.id));
    return ranked;
  }

  /** Flags likely-contradictory prior memories as superseded; conservative by design (LLM must clearly say "yes"). */
  private async detectAndResolveConflicts(workspaceId: string, newId: string, newContent: string, newEmbedding: number[]) {
    const candidates = this.repository
      .findSimilarActive(workspaceId, newId, newEmbedding, 3)
      .filter((candidate) => cosineSimilarity(newEmbedding, candidate.embedding!) >= CONFLICT_CANDIDATE_THRESHOLD);

    for (const candidate of candidates) {
      const conflicts = await this.judgeConflict(candidate.content, newContent);
      if (conflicts) this.repository.supersede(candidate.id, newId);
    }
  }

  private async judgeConflict(oldContent: string, newContent: string): Promise<boolean> {
    try {
      const response = await this.llm.complete({
        messages: [
          {
            role: "user",
            content: `Memory A: "${oldContent}"\nMemory B: "${newContent}"\nDoes Memory B contradict or supersede Memory A? Answer with exactly one word: yes or no.`,
          },
        ],
        tools: [],
        signal: new AbortController().signal,
      });
      return (response.content ?? "").trim().toLowerCase().startsWith("yes");
    } catch {
      return false;
    }
  }
}
