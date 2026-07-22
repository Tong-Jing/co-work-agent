import type { z } from "zod";

export type ToolRisk = "low" | "medium" | "high";

export interface ToolContext {
  workspaceRoot: string;
  signal: AbortSignal;
}

export interface ToolResult {
  content: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  risk: ToolRisk;
  source?: "local" | "mcp";
  mcpServer?: string;
  execute(input: TInput, context: ToolContext): Promise<ToolResult>;
}

export type AnyTool = Tool<any>;
