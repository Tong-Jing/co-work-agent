import { promoteAutoMemoryRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { AutoMemoryRepository } from "../../memory/auto-memory-repository.js";

export function registerAutoMemoryRoutes(app: FastifyInstance, autoMemories: AutoMemoryRepository) {
  app.get("/api/auto-memories", async () => autoMemories.listAllAcrossWorkspaces());

  app.post<{ Params: { id: string } }>("/api/auto-memories/:id/promote", async (request, reply) => {
    const input = promoteAutoMemoryRequestSchema.parse(request.body);
    console.log(`[auto-memories] promoting id=${request.params.id} category=${input.category}`);
    const shared = await autoMemories.promote(request.params.id, input.category);
    if (!shared) return reply.code(409).send({ message: "Auto memory not found or already shared" });
    return reply.code(201).send(shared);
  });

  app.delete<{ Params: { id: string } }>("/api/auto-memories/:id", async (request, reply) => {
    const removed = autoMemories.remove(request.params.id);
    return removed
      ? reply.code(204).send()
      : reply.code(404).send({ message: "Auto memory not found" });
  });
}
