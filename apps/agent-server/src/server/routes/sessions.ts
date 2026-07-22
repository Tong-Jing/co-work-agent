import {
  createMessageRequestSchema,
  createSessionRequestSchema,
} from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { RunController } from "../../agent/run-controller.js";
import type { RunService } from "../../sessions/run-service.js";
import type { SessionService } from "../../sessions/session-service.js";

export function registerSessionRoutes(
  app: FastifyInstance,
  sessions: SessionService,
  runs: RunService,
  runController: RunController,
) {
  app.get<{ Querystring: { workspaceId?: string } }>("/api/sessions", async (request, reply) => {
    if (!request.query.workspaceId) return reply.code(400).send({ message: "workspaceId is required" });
    return sessions.list(request.query.workspaceId);
  });

  app.post("/api/sessions", async (request, reply) => {
    const input = createSessionRequestSchema.parse(request.body ?? {});
    return reply.code(201).send(sessions.create(input.workspaceId, input.title));
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId", async (request, reply) => {
    const session = sessions.get(request.params.sessionId);
    if (!session) return reply.code(404).send({ message: "Session not found" });
    return {
      ...session,
      messages: sessions.listMessages(session.id),
      runs: runs.listEventsBySession(session.id),
    };
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/messages", async (request, reply) => {
    const input = createMessageRequestSchema.parse(request.body);
    console.log(`[sessions] POST /messages sessionId=${request.params.sessionId} contentLength=${input.content.length}`);
    try {
      const runId = runController.start(request.params.sessionId, input.content);
      console.log(`[sessions] run started runId=${runId} sessionId=${request.params.sessionId}`);
      return reply.code(202).send({ runId });
    } catch (error) {
      console.error(`[sessions] failed to start run sessionId=${request.params.sessionId}`, error);
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Session not found" });
    }
  });
}
