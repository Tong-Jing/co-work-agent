import { z } from "zod";

export const mcpServerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal("stdio"),
    command: z.string(),
    args: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal("http"),
    url: z.string(),
    enabled: z.boolean().default(true),
  }),
]);

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
