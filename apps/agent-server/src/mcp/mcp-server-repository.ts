import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CreateMcpServerRequest } from "@local-agent/contracts";

export interface CustomMcpServerRecord {
  id: string;
  name: string;
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  source: "custom";
  createdAt: string;
}

interface CustomMcpServerRow {
  id: string;
  name: string;
  type: "stdio" | "http";
  command: string | null;
  args: string | null;
  url: string | null;
  enabled: number;
  createdAt: string;
}

export class McpServerRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): CustomMcpServerRecord[] {
    const rows = this.database
      .prepare("SELECT id, name, type, command, args, url, enabled, created_at AS createdAt FROM custom_mcp_servers ORDER BY created_at")
      .all() as unknown as CustomMcpServerRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      ...(row.type === "stdio"
        ? { command: row.command ?? "", args: row.args ? (JSON.parse(row.args) as string[]) : [] }
        : { url: row.url ?? "" }),
      enabled: Boolean(row.enabled),
      source: "custom" as const,
      createdAt: row.createdAt,
    }));
  }

  add(input: CreateMcpServerRequest): CustomMcpServerRecord {
    const entry = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      command: input.type === "stdio" ? input.command : null,
      args: input.type === "stdio" ? JSON.stringify(input.args) : null,
      url: input.type === "http" ? input.url : null,
      enabled: input.enabled,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare("INSERT INTO custom_mcp_servers (id, name, type, command, args, url, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(entry.id, entry.name, entry.type, entry.command, entry.args, entry.url, entry.enabled ? 1 : 0, entry.createdAt);

    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      ...(entry.type === "stdio"
        ? { command: entry.command ?? "", args: entry.args ? (JSON.parse(entry.args) as string[]) : [] }
        : { url: entry.url ?? "" }),
      enabled: entry.enabled,
      source: "custom",
      createdAt: entry.createdAt,
    };
  }

  remove(id: string): boolean {
    const result = this.database.prepare("DELETE FROM custom_mcp_servers WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }
}
