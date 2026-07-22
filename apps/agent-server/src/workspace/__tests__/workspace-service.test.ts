import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../storage/database.js";
import { WorkspaceRepository } from "../workspace-repository.js";
import { WorkspaceService } from "../workspace-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "co-work-workspaces-"));
  temporaryDirectories.push(root);
  const database = createDatabase(":memory:");
  const repository = new WorkspaceRepository(database);
  const service = new WorkspaceService(root, repository);
  await service.verify();
  return { root, database, repository, service };
}

describe("WorkspaceService", () => {
  it("materializes the default workspace and its metadata directories", async () => {
    const { root, repository } = await setup();
    const [workspace] = repository.list();

    expect(workspace).toMatchObject({ name: "Default workspace", directoryName: "default-workspace" });
    await expect(stat(path.join(root, "default-workspace"))).resolves.toMatchObject({});
    await expect(stat(path.join(root, "default-workspace", ".co-work", "tmp"))).resolves.toMatchObject({});
  });

  it("creates isolated directories with collision-safe names", async () => {
    const { root, service } = await setup();
    const first = await service.create({ name: "Frontend" });
    const second = await service.create({ name: "Frontend" });

    expect(first.directoryName).toBe("frontend");
    expect(second.directoryName).toBe("frontend-2");
    expect(await service.resolve(first.id)).toBe(path.join(root, "frontend"));
    expect(await service.resolve(second.id)).toBe(path.join(root, "frontend-2"));
  });

  it("keeps files in one workspace out of another workspace path", async () => {
    const { service } = await setup();
    const first = await service.create({ name: "First" });
    const second = await service.create({ name: "Second" });
    const firstPaths = await service.pathsFor(first.id);
    const crossWorkspacePath = path.relative(await service.resolve(first.id), await service.resolve(second.id));

    expect(() => firstPaths.resolve(crossWorkspacePath)).toThrow("Path is outside the workspace");
    expect(() => firstPaths.resolve("../second/file.txt")).toThrow("Path is outside the workspace");
  });
});