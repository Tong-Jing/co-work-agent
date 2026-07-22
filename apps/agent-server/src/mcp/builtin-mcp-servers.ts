import type { McpServerConfig } from "./mcp-server-config.js";

export const builtinMcpServers: McpServerConfig[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    enabled: false,
  },
  {
    id: "github",
    name: "GitHub",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    enabled: false,
  },
  {
    id: "puppeteer",
    name: "Puppeteer (browser automation)",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    enabled: false,
  },
  {
    id: "memory",
    name: "Memory (knowledge graph)",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    enabled: false,
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabled: false,
  },
  {
    id: "sqlite",
    name: "SQLite",
    type: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-sqlite-npx"],
    enabled: false,
  },
  {
    id: "microsoft-docs",
    name: "Microsoft Docs",
    type: "http",
    url: "https://learn.microsoft.com/api/mcp",
    enabled: false,
  },
];
