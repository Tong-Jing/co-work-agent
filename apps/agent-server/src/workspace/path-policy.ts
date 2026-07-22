import path from "node:path";

const deniedSegments = new Set([".git", ".ssh", "node_modules"]);
const deniedNames = new Set([".env", ".npmrc"]);

export class PathPolicy {
  constructor(readonly workspaceRoot: string) {}

  resolve(relativePath: string) {
    if (path.isAbsolute(relativePath)) {
      throw new Error("Tool paths must be relative to the workspace");
    }

    const resolved = path.resolve(this.workspaceRoot, relativePath);
    const relative = path.relative(this.workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Path is outside the workspace");
    }

    const segments = relative.split(path.sep);
    if (segments.some((segment) => deniedSegments.has(segment)) || deniedNames.has(path.basename(resolved))) {
      throw new Error("Path is protected by the workspace policy");
    }

    return resolved;
  }
}
