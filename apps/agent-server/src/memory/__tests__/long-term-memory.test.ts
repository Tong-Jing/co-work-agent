import { describe, expect, it, vi } from "vitest";
import { LongTermMemory } from "../long-term-memory.js";
import type { LongTermMemoryItem, MemoryRepository } from "../memory-repository.js";
import type { EmbeddingProvider } from "../../llm/embedding-provider.js";
import type { LlmProvider } from "../../llm/llm-provider.js";

function makeItem(overrides: Partial<LongTermMemoryItem>): LongTermMemoryItem {
  return {
    id: overrides.id ?? "id",
    workspaceId: "workspace-1",
    category: "fact",
    content: overrides.content ?? "content",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    embedding: overrides.embedding ?? null,
  };
}

function makeRepository(overrides: Partial<MemoryRepository> = {}): MemoryRepository {
  return {
    add: vi.fn(),
    listActiveForWorkspace: vi.fn(() => []),
    recordRecall: vi.fn(),
    listAllAcrossWorkspaces: vi.fn(() => []),
    findSimilarActive: vi.fn(() => []),
    supersede: vi.fn(),
    addFromRequest: vi.fn((input) => ({
      id: "new-id",
      workspaceId: input.workspaceId,
      workspaceName: "",
      category: input.category,
      content: input.content,
      createdAt: new Date().toISOString(),
    })),
    remove: vi.fn(() => true),
    ...overrides,
  } as unknown as MemoryRepository;
}

describe("LongTermMemory.recall", () => {
  it("ranks candidates by a mix of semantic relevance and recency", async () => {
    const relevantButOld = makeItem({ id: "old", content: "use pnpm for installs", createdAt: new Date(Date.now() - 200 * 86_400_000).toISOString(), embedding: [1, 0] });
    const recentButUnrelated = makeItem({ id: "recent", content: "likes dark mode", createdAt: new Date().toISOString(), embedding: [0, 1] });

    const repository = makeRepository({ listActiveForWorkspace: vi.fn(() => [relevantButOld, recentButUnrelated]) });
    const embeddings: EmbeddingProvider = { embed: vi.fn(async () => [1, 0]) };
    const llm: LlmProvider = { complete: vi.fn() };

    const memory = new LongTermMemory(repository, embeddings, llm);
    const results = await memory.recall("workspace-1", "which package manager do we use?");

    expect(results[0]!.id).toBe("old");
    expect(repository.recordRecall).toHaveBeenCalledWith(["old", "recent"]);
  });

  it("falls back to pure recency ordering when embeddings are unavailable", async () => {
    const older = makeItem({ id: "older", createdAt: new Date(Date.now() - 1000).toISOString() });
    const newer = makeItem({ id: "newer", createdAt: new Date().toISOString() });
    const repository = makeRepository({ listActiveForWorkspace: vi.fn(() => [older, newer]) });
    const embeddings: EmbeddingProvider = { embed: vi.fn(async () => { throw new Error("no embeddings configured"); }) };
    const llm: LlmProvider = { complete: vi.fn() };

    const memory = new LongTermMemory(repository, embeddings, llm);
    const results = await memory.recall("workspace-1", "anything");

    expect(results.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("LongTermMemory.remember", () => {
  it("marks a similar prior memory as superseded when the LLM judges a conflict", async () => {
    const priorMemory = makeItem({ id: "prior", content: "the project uses npm", embedding: [1, 0] });
    const repository = makeRepository({
      findSimilarActive: vi.fn(() => [priorMemory]),
    });
    const embeddings: EmbeddingProvider = { embed: vi.fn(async () => [1, 0]) };
    const llm: LlmProvider = { complete: vi.fn(async () => ({ id: "r", content: "yes", toolCalls: [] })) };

    const memory = new LongTermMemory(repository, embeddings, llm);
    await memory.remember("workspace-1", "fact", "the project now uses pnpm instead of npm");

    expect(repository.supersede).toHaveBeenCalledWith("prior", "new-id");
  });

  it("does not supersede when the LLM judges no conflict", async () => {
    const priorMemory = makeItem({ id: "prior", content: "user is a backend developer", embedding: [1, 0] });
    const repository = makeRepository({
      findSimilarActive: vi.fn(() => [priorMemory]),
    });
    const embeddings: EmbeddingProvider = { embed: vi.fn(async () => [1, 0]) };
    const llm: LlmProvider = { complete: vi.fn(async () => ({ id: "r", content: "no", toolCalls: [] })) };

    const memory = new LongTermMemory(repository, embeddings, llm);
    await memory.remember("workspace-1", "fact", "user also knows some frontend");

    expect(repository.supersede).not.toHaveBeenCalled();
  });
});
