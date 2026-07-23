import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_WORKSPACE_NAME = "Default workspace";

export function createDatabase(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      directory_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_events_session ON run_events(session_id, run_id, sequence);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('created', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
      iteration INTEGER NOT NULL DEFAULT 0,
      checkpoint TEXT,
      checkpoint_sequence INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      last_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT,
      url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      content TEXT NOT NULL,
      shared_memory_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auto_memories_workspace ON auto_memories(workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS builtin_mcp_server_overrides (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_rules (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      matcher_kind TEXT NOT NULL,
      matcher_pattern TEXT,
      matcher_field TEXT,
      matcher_values TEXT,
      decision TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_permission_rules_workspace_tool ON permission_rules(workspace_id, tool_name);

    CREATE TABLE IF NOT EXISTS builtin_permission_rule_overrides (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      nodes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_definitions_workspace ON workflow_definitions(workspace_id);

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      current_node_id TEXT,
      node_states TEXT NOT NULL DEFAULT '{}',
      variables TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, created_at);
  `);

  const agentRunColumns = database.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>;
  if (!agentRunColumns.some((column) => column.name === "checkpoint_sequence")) {
    database.exec("ALTER TABLE agent_runs ADD COLUMN checkpoint_sequence INTEGER NOT NULL DEFAULT 0");
  }

  const workspaceColumns = database.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
  if (!workspaceColumns.some((column) => column.name === "directory_name")) {
    database.exec("ALTER TABLE workspaces ADD COLUMN directory_name TEXT");
    const existingWorkspaces = database.prepare("SELECT id, name FROM workspaces ORDER BY created_at").all() as unknown as Array<{ id: string; name: string }>;
    const usedNames = new Set<string>();
    for (const [index, workspace] of existingWorkspaces.entries()) {
      const baseName = index === 0 ? "default-workspace" : toDirectoryName(workspace.name);
      let directoryName = baseName;
      let suffix = 2;
      while (usedNames.has(directoryName)) directoryName = `${baseName}-${suffix++}`;
      usedNames.add(directoryName);
      database.prepare("UPDATE workspaces SET directory_name = ? WHERE id = ?").run(directoryName, workspace.id);
    }
  }
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_directory_name ON workspaces(directory_name)");

  const messageColumns = database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === "run_id")) {
    database.exec("ALTER TABLE messages ADD COLUMN run_id TEXT");
  }

  const defaultWorkspaceId = ensureDefaultWorkspace(database);

  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === "workspace_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN workspace_id TEXT");
    database.prepare("UPDATE sessions SET workspace_id = ? WHERE workspace_id IS NULL").run(defaultWorkspaceId);
  }

  const memoryColumns = database.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
  if (!memoryColumns.some((column) => column.name === "workspace_id")) {
    database.exec("ALTER TABLE memories ADD COLUMN workspace_id TEXT");
    database.prepare("UPDATE memories SET workspace_id = ? WHERE workspace_id IS NULL").run(defaultWorkspaceId);
  }

  const memoryEmbeddingColumns = database.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
  if (!memoryEmbeddingColumns.some((column) => column.name === "embedding")) {
    database.exec("ALTER TABLE memories ADD COLUMN embedding TEXT");
  }
  if (!memoryEmbeddingColumns.some((column) => column.name === "status")) {
    database.exec("ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!memoryEmbeddingColumns.some((column) => column.name === "superseded_by")) {
    database.exec("ALTER TABLE memories ADD COLUMN superseded_by TEXT REFERENCES memories(id)");
  }
  if (!memoryEmbeddingColumns.some((column) => column.name === "last_recalled_at")) {
    database.exec("ALTER TABLE memories ADD COLUMN last_recalled_at TEXT");
  }
  if (!memoryEmbeddingColumns.some((column) => column.name === "recall_count")) {
    database.exec("ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0");
  }

  const autoMemoryColumns = database.prepare("PRAGMA table_info(auto_memories)").all() as Array<{ name: string }>;
  if (!autoMemoryColumns.some((column) => column.name === "embedding")) {
    database.exec("ALTER TABLE auto_memories ADD COLUMN embedding TEXT");
  }
  if (!autoMemoryColumns.some((column) => column.name === "content_hash")) {
    database.exec("ALTER TABLE auto_memories ADD COLUMN content_hash TEXT");
    database.exec("CREATE INDEX IF NOT EXISTS idx_auto_memories_content_hash ON auto_memories(workspace_id, content_hash)");
  }
  if (!autoMemoryColumns.some((column) => column.name === "hit_count")) {
    database.exec("ALTER TABLE auto_memories ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 1");
  }

  const customSkillColumns = database.prepare("PRAGMA table_info(custom_skills)").all() as Array<{ name: string }>;
  if (!customSkillColumns.some((column) => column.name === "version")) {
    database.exec("ALTER TABLE custom_skills ADD COLUMN version TEXT NOT NULL DEFAULT '1.0.0'");
  }
  if (!customSkillColumns.some((column) => column.name === "task_types")) {
    database.exec("ALTER TABLE custom_skills ADD COLUMN task_types TEXT NOT NULL DEFAULT '[]'");
  }
  if (!customSkillColumns.some((column) => column.name === "required_tools")) {
    database.exec("ALTER TABLE custom_skills ADD COLUMN required_tools TEXT NOT NULL DEFAULT '[]'");
  }
  if (!customSkillColumns.some((column) => column.name === "risk")) {
    database.exec("ALTER TABLE custom_skills ADD COLUMN risk TEXT NOT NULL DEFAULT 'low'");
  }

  const mcpServerColumns = database.prepare("PRAGMA table_info(custom_mcp_servers)").all() as Array<{
    name: string;
    notnull: number;
  }>;  const commandColumn = mcpServerColumns.find((column) => column.name === "command");
  if (commandColumn?.notnull) {
    database.exec(`
      CREATE TABLE custom_mcp_servers_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'stdio',
        command TEXT,
        args TEXT,
        url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      INSERT INTO custom_mcp_servers_new (id, name, type, command, args, url, enabled, created_at)
        SELECT id, name, 'stdio', command, args, NULL, enabled, created_at FROM custom_mcp_servers;
      DROP TABLE custom_mcp_servers;
      ALTER TABLE custom_mcp_servers_new RENAME TO custom_mcp_servers;
    `);
  } else {
    if (!mcpServerColumns.some((column) => column.name === "type")) {
      database.exec("ALTER TABLE custom_mcp_servers ADD COLUMN type TEXT NOT NULL DEFAULT 'stdio'");
    }
    if (!mcpServerColumns.some((column) => column.name === "url")) {
      database.exec("ALTER TABLE custom_mcp_servers ADD COLUMN url TEXT");
    }
  }

  return database;
}

function ensureDefaultWorkspace(database: DatabaseSync): string {
  const existing = database.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  database
    .prepare("INSERT INTO workspaces (id, name, directory_name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, DEFAULT_WORKSPACE_NAME, "default-workspace", new Date().toISOString());
  return id;
}

function toDirectoryName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || "workspace";
}
