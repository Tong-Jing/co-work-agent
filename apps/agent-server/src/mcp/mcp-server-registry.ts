import type { McpServerConfig } from "./mcp-server-config.js";

export class McpServerRegistry {
  readonly #servers = new Map<string, McpServerConfig>();

  register(config: McpServerConfig) {
    this.#servers.set(config.id, config);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const existing = this.#servers.get(id);
    if (!existing) return false;
    this.#servers.set(id, { ...existing, enabled });
    return true;
  }

  listEnabled() {
    return [...this.#servers.values()].filter((server) => server.enabled);
  }

  listAll() {
    return [...this.#servers.values()];
  }
}
