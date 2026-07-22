import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { AutoMemoryRepository } from "../auto-memory-repository.js";
import type { LongTermMemory } from "../long-term-memory.js";
import type { EmbeddingProvider } from "../../llm/embedding-provider.js";

function makeLongTermMemory(): LongTermMemory {
  return {
    rememberAndReturn: vi.fn(async (workspaceId: string, category: string, content: string) => ({
      id: "shared-id",
      workspaceId,
      workspaceName: "",
      category,
      content,
      createdAt: new Date().toISOString(),
    })),
  } as unknown as LongTermMemory;
}

function makeEmbeddings(): EmbeddingProvider {
  return { embed: vi.fn(async () => [1, 0, 0]) };
}

function setup() {
  const database = createDatabase(":memory:");
  const workspaceId = (database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string }).id;
  const longTermMemory = makeLongTermMemory();
  const embeddings = makeEmbeddings();
  const repository = new AutoMemoryRepository(database, longTermMemory, embeddings);
  return { repository, workspaceId, longTermMemory, embeddings };
}

describe("AutoMemoryRepository", () => {
  it("deduplicates near-identical content by hash and refreshes its timestamp instead of inserting again", async () => {
    const { repository, workspaceId, embeddings } = setup();

    const first = await repository.add(workspaceId, "session-1", "run-1", "Uses npm for installs.");
    const second = await repository.add(workspaceId, "session-2", "run-2", "uses npm for installs");

    expect(second.id).toBe(first.id);
    expect(repository.listAllAcrossWorkspaces()).toHaveLength(1);
    expect(embeddings.embed).toHaveBeenCalledTimes(1);
  });

  it("increments hitCount on duplicate hits and starts new entries at 1", async () => {
    const { repository, workspaceId } = setup();

    const first = await repository.add(workspaceId, "session-1", "run-1", "Uses npm for installs.");
    expect(first.hitCount).toBe(1);

    await repository.add(workspaceId, "session-2", "run-2", "uses npm for installs");
    await repository.add(workspaceId, "session-3", "run-3", "USES NPM FOR INSTALLS");

    const [entry] = repository.listAllAcrossWorkspaces();
    expect(entry!.hitCount).toBe(3);
  });

  it("stores distinct content as separate entries", async () => {
    const { repository, workspaceId } = setup();

    await repository.add(workspaceId, "session-1", "run-1", "Uses npm for installs.");
    await repository.add(workspaceId, "session-1", "run-2", "Uses pnpm for installs.");

    expect(repository.listAllAcrossWorkspaces()).toHaveLength(2);
  });

  it("promotes through LongTermMemory so conflict detection runs, and records the shared memory id", async () => {
    const { repository, workspaceId, longTermMemory } = setup();
    const entry = await repository.add(workspaceId, "session-1", "run-1", "Uses npm for installs.");

    const promoted = await repository.promote(entry.id, "tooling");

    expect(longTermMemory.rememberAndReturn).toHaveBeenCalledWith(workspaceId, "tooling", "Uses npm for installs.");
    expect(promoted?.id).toBe("shared-id");
    expect(repository.get(entry.id)?.sharedMemoryId).toBe("shared-id");
  });

  it("refuses to promote the same auto memory twice", async () => {
    const { repository, workspaceId } = setup();
    const entry = await repository.add(workspaceId, "session-1", "run-1", "Uses npm for installs.");

    await repository.promote(entry.id, "tooling");
    const secondAttempt = await repository.promote(entry.id, "tooling");

    expect(secondAttempt).toBeNull();
  });
});
