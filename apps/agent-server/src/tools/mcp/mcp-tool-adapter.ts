import type { Tool } from "../tool.js";

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolAdapter {
  adapt(descriptor: McpToolDescriptor): Tool;
}
