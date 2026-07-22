import { describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { MemoryRepository } from "../memory-repository.js";

function setup() {
  const database = createDatabase(":memory:");
  const workspaceId = (database.prepare("SELECT id FROM workspaces LIMIT 1").get() as { id: string }).id;
  return { repository: new MemoryRepository(database), workspaceId };
}

describe("MemoryRepository", () => {
  it("adds a memory as active with zero recall stats", () => {
    const { repository, workspaceId } = setup();
    const entry = repository.addFromRequest({ workspaceId, category: "convention", content: "use pnpm" });

    expect(entry).toMatchObject({ status: "active", supersededBy: null, lastRecalledAt: null, recallCount: 0 });
    expect(repository.listAllAcrossWorkspaces()).toHaveLength(1);
  });

  it("tracks recall hits via recordRecall", () => {
    const { repository, workspaceId } = setup();
    const entry = repository.addFromRequest({ workspaceId, category: "convention", content: "use pnpm" });

    repository.recordRecall([entry.id]);
    repository.recordRecall([entry.id]);

    const [updated] = repository.listAllAcrossWorkspaces();
    expect(updated!.recallCount).toBe(2);
    expect(updated!.lastRecalledAt).toBeTruthy();
  });

  it("moves a memory to the archived list when superseded, and back when restored", () => {
    const { repository, workspaceId } = setup();
    const oldEntry = repository.addFromRequest({ workspaceId, category: "convention", content: "use npm" });
    const newEntry = repository.addFromRequest({ workspaceId, category: "convention", content: "use pnpm" });

    repository.supersede(oldEntry.id, newEntry.id);

    expect(repository.listAllAcrossWorkspaces().map((entry) => entry.id)).toEqual([newEntry.id]);
    const [archived] = repository.listArchivedAcrossWorkspaces();
    expect(archived).toMatchObject({ id: oldEntry.id, status: "superseded", supersededBy: newEntry.id });

    expect(repository.restore(oldEntry.id)).toBe(true);
    expect(repository.listArchivedAcrossWorkspaces()).toEqual([]);
    expect(repository.listAllAcrossWorkspaces().map((entry) => entry.id).sort()).toEqual([oldEntry.id, newEntry.id].sort());
  });

  it("returns false when restoring a memory that isn't archived", () => {
    const { repository, workspaceId } = setup();
    const entry = repository.addFromRequest({ workspaceId, category: "convention", content: "use pnpm" });

    expect(repository.restore(entry.id)).toBe(false);
    expect(repository.restore("nonexistent")).toBe(false);
  });
});
