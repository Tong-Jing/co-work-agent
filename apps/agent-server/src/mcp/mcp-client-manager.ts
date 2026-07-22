import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { AnyTool, Tool, ToolContext, ToolResult } from "../tools/tool.js";
import type { McpServerConfig } from "./mcp-server-config.js";
import type { McpServerRegistry } from "./mcp-server-registry.js";

const passthroughInputSchema = z.record(z.string(), z.unknown());
const CONNECTION_TIMEOUT_MS = 15_000;

export interface McpConnectionStatus {
  state: "connected" | "failed" | "untested";
  toolNames: string[];
  errorMessage: string | null;
  checkedAt: string | null;
}

export interface McpConnectionTestResult {
  success: boolean;
  toolCount: number;
  toolNames: string[];
  errorMessage: string | null;
}

export class McpClientManager {
  readonly #connectionStatus = new Map<string, McpConnectionStatus>();

  constructor(private readonly servers: McpServerRegistry) {}

  async discoverTools(): Promise<AnyTool[]> {
    const enabled = this.servers.listEnabled();
    const tools: AnyTool[] = [];

    for (const server of enabled) {
      try {
        const serverTools = await this.withTimeout(this.connectAndListTools(server), CONNECTION_TIMEOUT_MS);
        console.log(`[mcp] connected to ${server.name} (${server.id}), discovered ${serverTools.length} tool(s)`);
        this.#connectionStatus.set(server.id, {
          state: "connected",
          toolNames: serverTools.map((tool) => tool.name),
          errorMessage: null,
          checkedAt: new Date().toISOString(),
        });
        tools.push(...serverTools);
      } catch (error) {
        console.error(`[mcp] failed to connect to MCP server ${server.name} (${server.id}), skipping`, error);
        this.#connectionStatus.set(server.id, {
          state: "failed",
          toolNames: [],
          errorMessage: error instanceof Error ? error.message : "Unknown connection error",
          checkedAt: new Date().toISOString(),
        });
      }
    }

    return tools;
  }

  getConnectionStatus(serverId: string): McpConnectionStatus {
    return this.#connectionStatus.get(serverId) ?? { state: "untested", toolNames: [], errorMessage: null, checkedAt: null };
  }

  /** One-off connection check used by the "test connection" UI action; does not register tools globally. */
  async testConnection(server: McpServerConfig): Promise<McpConnectionTestResult> {
    try {
      const serverTools = await this.withTimeout(this.connectAndListTools(server), CONNECTION_TIMEOUT_MS);
      return { success: true, toolCount: serverTools.length, toolNames: serverTools.map((tool) => tool.name), errorMessage: null };
    } catch (error) {
      return { success: false, toolCount: 0, toolNames: [], errorMessage: error instanceof Error ? error.message : "Unknown connection error" };
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`MCP connection timed out after ${ms}ms`)), ms)),
    ]);
  }

  private async connectAndListTools(server: McpServerConfig): Promise<AnyTool[]> {
    const transport = (server.type === "http"
      ? new StreamableHTTPClientTransport(new URL(server.url))
      : new StdioClientTransport({ command: server.command, args: server.args })) as Transport;
    const client = new Client({ name: "co-work-agent", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const { tools } = await client.listTools();
    return tools.map((descriptor) => this.adapt(server, client, descriptor));
  }

  private adapt(
    server: McpServerConfig,
    client: Client,
    descriptor: Awaited<ReturnType<Client["listTools"]>>["tools"][number],
  ): Tool {
    return {
      name: `mcp_${server.id}_${descriptor.name}`,
      description: descriptor.description ?? `MCP tool ${descriptor.name} from ${server.name}`,
      inputSchema: passthroughInputSchema,
      risk: "medium",
      source: "mcp",
      mcpServer: server.name,
      async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const result = await client.callTool({ name: descriptor.name, arguments: input });
        const content = Array.isArray(result.content)
          ? result.content.map((item) => ("text" in item ? item.text : JSON.stringify(item))).join("\n")
          : JSON.stringify(result.content);
        return {
          content: content || "(no content returned)",
          summary: `Called MCP tool ${descriptor.name} on ${server.name}`,
        };
      },
    };
  }
}
