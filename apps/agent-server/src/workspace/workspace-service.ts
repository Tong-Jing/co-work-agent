import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PathPolicy } from "./path-policy.js";
import type { CreateWorkspaceRequest, Workspace } from "@local-agent/contracts";
import type { WorkspaceRepository } from "./workspace-repository.js";

export class WorkspaceService {
  constructor(readonly root: string, private readonly repository: WorkspaceRepository) {}

  async verify() {
    await mkdir(this.root, { recursive: true });
    const info = await stat(this.root);
    if (!info.isDirectory()) throw new Error("Workspace root is not a directory");
    for (const workspace of this.repository.list()) await this.ensureDirectory(workspace);
  }

  list(): Workspace[] {
    return this.repository.list();
  }

  async create(input: CreateWorkspaceRequest): Promise<Workspace> {
    const directoryName = this.nextDirectoryName(input.name);
    const directory = this.resolveDirectory(directoryName);
    await mkdir(directory, { recursive: false });
    try {
      await this.ensureMetadataDirectories(directory);
      return this.repository.create(input, directoryName);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async resolve(workspaceId: string): Promise<string> {
    const workspace = this.repository.get(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    await this.ensureDirectory(workspace);
    return this.resolveDirectory(workspace.directoryName);
  }

  async pathsFor(workspaceId: string): Promise<PathPolicy> {
    return new PathPolicy(await this.resolve(workspaceId));
  }

  private nextDirectoryName(name: string): string {
    const normalized = name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace";
    const existing = new Set(this.repository.list().map((workspace) => workspace.directoryName));
    if (!existing.has(normalized)) return normalized;
    let suffix = 2;
    while (existing.has(`${normalized}-${suffix}`)) suffix++;
    return `${normalized}-${suffix}`;
  }

  private resolveDirectory(directoryName: string): string {
    const resolved = path.resolve(this.root, directoryName);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid workspace directory");
    return resolved;
  }

  private async ensureDirectory(workspace: Workspace) {
    const directory = this.resolveDirectory(workspace.directoryName);
    await mkdir(directory, { recursive: true });
    await this.ensureMetadataDirectories(directory);
  }

  private async ensureMetadataDirectories(directory: string) {
    await Promise.all([
      mkdir(path.join(directory, ".co-work", "tmp"), { recursive: true }),
      mkdir(path.join(directory, ".co-work", "artifacts"), { recursive: true }),
      mkdir(path.join(directory, ".co-work", "logs"), { recursive: true }),
    ]);
  }
}
