import { createMcpServerRequestSchema, testMcpConnectionRequestSchema } from "@local-agent/contracts";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { BuiltinMcpOverrideRepository } from "../../mcp/builtin-mcp-override-repository.js";
import type { McpServerRegistry } from "../../mcp/mcp-server-registry.js";
import type { McpServerRepository } from "../../mcp/mcp-server-repository.js";
import type { McpClientManager } from "../../mcp/mcp-client-manager.js";

export function registerMcpServerRoutes(
  app: FastifyInstance,
  builtinServers: McpServerRegistry,
  customServers: McpServerRepository,
  builtinOverrides: BuiltinMcpOverrideRepository,
  mcpClients: McpClientManager,
) {
  app.get("/api/mcp-servers", async () => {
    const builtin = builtinServers.listAll().map((server) => {
      const status = mcpClients.getConnectionStatus(server.id);
      return {
        id: server.id,
        name: server.name,
        type: server.type,
        ...(server.type === "stdio" ? { command: server.command, args: server.args } : { url: server.url }),
        enabled: server.enabled,
        source: "builtin" as const,
        createdAt: "",
        connectionState: server.enabled ? status.state : ("untested" as const),
        toolNames: status.toolNames,
        errorMessage: status.errorMessage,
      };
    });
    const custom = customServers.list().map((server) => {
      const status = mcpClients.getConnectionStatus(server.id);
      return {
        ...server,
        connectionState: server.enabled ? status.state : ("untested" as const),
        toolNames: status.toolNames,
        errorMessage: status.errorMessage,
      };
    });
    return [...builtin, ...custom];
  });

  app.post("/api/mcp-servers", async (request, reply) => {
    const input = createMcpServerRequestSchema.parse(request.body);
    console.log(`[mcp-servers] adding custom server name=${input.name} type=${input.type}`);
    const created = customServers.add(input);
    return reply.code(201).send({ ...created, connectionState: "untested" as const, toolNames: [], errorMessage: null });
  });

  app.post("/api/mcp-servers/test", async (request, reply) => {
    const input = testMcpConnectionRequestSchema.parse(request.body);
    const config = input.type === "stdio"
      ? { id: `test-${randomUUID()}`, name: input.name, type: "stdio" as const, command: input.command, args: input.args, enabled: true }
      : { id: `test-${randomUUID()}`, name: input.name, type: "http" as const, url: input.url, enabled: true };
    const result = await mcpClients.testConnection(config);
    return reply.code(200).send(result);
  });

  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/mcp-servers/:id/toggle",
    async (request, reply) => {
      const { enabled } = request.body;
      const updated = builtinServers.setEnabled(request.params.id, enabled);
      if (!updated) return reply.code(404).send({ message: "Builtin MCP server not found" });
      builtinOverrides.setEnabled(request.params.id, enabled);
      console.log(`[mcp-servers] toggled builtin server id=${request.params.id} enabled=${enabled} (restart required to take effect)`);
      return reply.code(200).send({ id: request.params.id, enabled, restartRequired: true });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/mcp-servers/:id", async (request, reply) => {
    const removed = customServers.remove(request.params.id);
    return removed
      ? reply.code(204).send()
      : reply.code(404).send({ message: "Custom MCP server not found" });
  });
}
