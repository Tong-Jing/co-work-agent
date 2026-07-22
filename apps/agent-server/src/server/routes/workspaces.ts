import { createWorkspaceRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { WorkspaceService } from "../../workspace/workspace-service.js";

export function registerWorkspaceRoutes(app: FastifyInstance, workspaces: WorkspaceService) {
  app.get("/api/workspaces", async () => workspaces.list());

  app.post("/api/workspaces", async (request, reply) => {
    const input = createWorkspaceRequestSchema.parse(request.body);
    console.log(`[workspaces] creating workspace name=${input.name}`);
    return reply.code(201).send(await workspaces.create(input));
  });
}
