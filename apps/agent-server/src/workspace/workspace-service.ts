import { stat } from "node:fs/promises";
import { PathPolicy } from "./path-policy.js";

export class WorkspaceService {
  readonly paths: PathPolicy;

  constructor(readonly root: string) {
    this.paths = new PathPolicy(root);
  }

  async verify() {
    const info = await stat(this.root);
    if (!info.isDirectory()) throw new Error("Workspace root is not a directory");
  }
}
