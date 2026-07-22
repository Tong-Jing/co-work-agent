export type SkillRisk = "low" | "medium" | "high";

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  source: "bundled" | "custom";
  version: string;
  taskTypes: string[];
  requiredTools: string[];
  risk: SkillRisk;
}
