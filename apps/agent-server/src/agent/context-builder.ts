import type { MemoryService } from "../memory/memory-service.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import type { SkillSelector } from "../skills/skill-selector.js";
import type { LlmMessage } from "../llm/llm-types.js";
import type { AgentConfig } from "./agent-config.js";

// Always available regardless of skill selection, so the agent can still explore the workspace
// even when the selected skill(s) declare a narrower requiredTools list.
export const BASELINE_TOOLS = ["list_files", "read_file", "search_files"];

export class ContextBuilder {
  constructor(
    private readonly memory: MemoryService,
    private readonly skills: SkillRegistry,
    private readonly skillSelector: SkillSelector,
  ) {}

  async build(
    config: AgentConfig,
    sessionId: string,
    workspaceId: string,
    prompt: string,
    workspaceRoot: string,
    forcedSkillId?: string,
  ) {
    const memories = await this.memory.longTerm.recall(workspaceId, prompt);
    const forcedSkill = forcedSkillId ? this.skills.list().find((skill) => skill.id === forcedSkillId) : undefined;
    const selectedSkills = forcedSkill ? [forcedSkill] : this.skillSelector.select(prompt, this.skills.list());
    const history = this.memory.conversation.getMessages(sessionId);
    const context = [
      config.systemInstructions,
      `Workspace root: ${workspaceRoot}`,
      memories.length ? `Relevant long-term memory:\n${memories.map((item) => `- [${item.category}] ${item.content}`).join("\n")}` : "",
      selectedSkills.length ? `Task skills:\n${selectedSkills.map((skill) => skill.instructions).join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const messages: LlmMessage[] = [
      { role: "system", content: context },
      ...history.map((message): LlmMessage => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const allowedTools = this.resolveAllowedTools(selectedSkills);

    return {
      messages,
      allowedTools,
      gathered: {
        memoryCount: memories.length,
        skillCount: selectedSkills.length,
        historyCount: history.length,
      },
    };
  }

  private resolveAllowedTools(selectedSkills: ReturnType<SkillSelector["select"]>): string[] | null {
    const skillsWithRequiredTools = selectedSkills.filter((skill) => skill.requiredTools.length > 0);
    if (skillsWithRequiredTools.length === 0) return null;

    const union = new Set([...BASELINE_TOOLS, ...skillsWithRequiredTools.flatMap((skill) => skill.requiredTools)]);
    return [...union];
  }
}
