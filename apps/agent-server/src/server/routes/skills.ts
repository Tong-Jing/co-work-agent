import { createSkillRequestSchema, updateSkillRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { SkillRegistry } from "../../skills/skill-registry.js";
import type { SkillRepository } from "../../skills/skill-repository.js";

export function registerSkillRoutes(
  app: FastifyInstance,
  bundledSkills: SkillRegistry,
  customSkills: SkillRepository,
) {
  app.get("/api/skills", async () => {
    const bundled = bundledSkills.list()
      .filter((skill) => skill.source === "bundled")
      .map((skill) => ({ ...skill, createdAt: "" }));
    return [...bundled, ...customSkills.list()];
  });

  app.post("/api/skills", async (request, reply) => {
    const input = createSkillRequestSchema.parse(request.body);
    console.log(`[skills] adding custom skill name=${input.name}`);
    const created = customSkills.add(input);
    bundledSkills.register({ ...created, source: "custom" });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const input = updateSkillRequestSchema.parse(request.body);
    console.log(`[skills] updating custom skill id=${request.params.id}`);
    const updated = customSkills.update(request.params.id, input);
    if (!updated) return reply.code(404).send({ message: "Custom skill not found" });
    bundledSkills.register({ ...updated, source: "custom" });
    return reply.code(200).send(updated);
  });

  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const removed = customSkills.remove(request.params.id);
    if (!removed) return reply.code(404).send({ message: "Custom skill not found" });
    bundledSkills.remove(request.params.id);
    return reply.code(204).send();
  });
}
