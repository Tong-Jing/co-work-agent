import type { DatabaseSync } from "node:sqlite";

export class BuiltinMcpOverrideRepository {
  constructor(private readonly database: DatabaseSync) {}

  getEnabledOverride(id: string): boolean | null {
    const row = this.database
      .prepare("SELECT enabled FROM builtin_mcp_server_overrides WHERE id = ?")
      .get(id) as unknown as { enabled: number } | undefined;
    return row ? Boolean(row.enabled) : null;
  }

  setEnabled(id: string, enabled: boolean) {
    this.database
      .prepare("INSERT INTO builtin_mcp_server_overrides (id, enabled) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled")
      .run(id, enabled ? 1 : 0);
  }
}
