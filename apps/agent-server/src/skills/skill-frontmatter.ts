import { z } from "zod";

export const skillFrontmatterSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().default(""),
  version: z.string().trim().default("1.0.0"),
  taskTypes: z.array(z.string().trim().min(1)).default([]),
  requiredTools: z.array(z.string().trim().min(1)).default([]),
  risk: z.enum(["low", "medium", "high"]).default("low"),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;
