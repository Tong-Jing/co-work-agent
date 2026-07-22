import { createWorkspaceRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { WorkspaceRepository } from "../../workspace/workspace-repository.js";

export function registerWorkspaceRoutes(app: FastifyInstance, workspaces: WorkspaceRepository) {
  app.get("/api/workspaces", async () => workspaces.list());

  app.post("/api/workspaces", async (request, reply) => {
    const input = createWorkspaceRequestSchema.parse(request.body);
    console.log(`[workspaces] creating workspace name=${input.name}`);
    return reply.code(201).send(workspaces.create(input));
  });
}
