import { describe, expect, it } from "vitest";
import { McpServerRegistry } from "../mcp-server-registry.js";
import { McpClientManager } from "../mcp-client-manager.js";

describe("McpClientManager.getConnectionStatus", () => {
  it("returns an untested default status for a server that has never been checked", () => {
    const manager = new McpClientManager(new McpServerRegistry());
    expect(manager.getConnectionStatus("unknown-server")).toEqual({
      state: "untested",
      toolNames: [],
      errorMessage: null,
      checkedAt: null,
    });
  });

  it("records a failed connection status when discovery cannot reach a configured server", async () => {
    const registry = new McpServerRegistry();
    registry.register({ id: "broken", name: "Broken", type: "stdio", command: "definitely-not-a-real-command", args: [], enabled: true });
    const manager = new McpClientManager(registry);

    await manager.discoverTools();

    const status = manager.getConnectionStatus("broken");
    expect(status.state).toBe("failed");
    expect(status.errorMessage).toBeTruthy();
    expect(status.checkedAt).toBeTruthy();
  });
});
