import { createMemoryRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { MemoryRepository } from "../../memory/memory-repository.js";
import type { LongTermMemory } from "../../memory/long-term-memory.js";

export function registerMemoryRoutes(app: FastifyInstance, memories: MemoryRepository, longTermMemory: LongTermMemory) {
  app.get("/api/memories", async () => memories.listAllAcrossWorkspaces());

  app.get("/api/memories/archived", async () => memories.listArchivedAcrossWorkspaces());

  app.post<{ Params: { id: string } }>("/api/memories/:id/restore", async (request, reply) => {
    const restored = memories.restore(request.params.id);
    return restored
      ? reply.code(200).send({ id: request.params.id, restored: true })
      : reply.code(404).send({ message: "Archived memory not found" });
  });

  app.post("/api/memories", async (request, reply) => {
    const input = createMemoryRequestSchema.parse(request.body);
    console.log(`[memories] adding memory workspaceId=${input.workspaceId} category=${input.category}`);
    const entry = await longTermMemory.rememberAndReturn(input.workspaceId, input.category, input.content);
    return reply.code(201).send(entry);
  });

  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (request, reply) => {
    const removed = memories.remove(request.params.id);
    return removed
      ? reply.code(204).send()
      : reply.code(404).send({ message: "Memory not found" });
  });
}
