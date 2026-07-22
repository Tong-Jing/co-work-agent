import type { AgentEvent } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { RunController } from "../../agent/run-controller.js";
import type { RunService } from "../../sessions/run-service.js";

const terminalEvents = new Set<AgentEvent["type"]>(["run.completed", "run.cancelled", "run.failed"]);

export function registerRunRoutes(app: FastifyInstance, runs: RunService, controller: RunController) {
  app.get<{ Params: { runId: string }; Headers: { "last-event-id"?: string } }>(
    "/api/runs/:runId/events",
    async (request, reply) => {
      if (!runs.get(request.params.runId)) {
        console.warn(`[runs] SSE subscribe rejected, run not found runId=${request.params.runId}`);
        return reply.code(404).send({ message: "Run not found" });
      }
      console.log(`[runs] SSE client subscribed runId=${request.params.runId}`);

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const afterSequence = Number.parseInt(request.headers["last-event-id"] ?? "0", 10) || 0;
      let unsubscribe: (() => boolean) | null = null;
      const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
      const close = () => {
        clearInterval(heartbeat);
        unsubscribe?.();
        if (!reply.raw.writableEnded) reply.raw.end();
      };

      unsubscribe = runs.subscribe(request.params.runId, (event) => {
        reply.raw.write(`id: ${event.sequence}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (terminalEvents.has(event.type)) {
          console.log(`[runs] SSE closing after terminal event runId=${request.params.runId} type=${event.type}`);
          close();
        }
      }, afterSequence);
      request.raw.on("close", close);
    },
  );

  app.post<{ Params: { runId: string } }>("/api/runs/:runId/cancel", async (request, reply) => {
    return controller.cancel(request.params.runId)
      ? reply.code(202).send({ accepted: true })
      : reply.code(404).send({ message: "Run not found" });
  });
}
