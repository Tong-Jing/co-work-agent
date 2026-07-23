import { createWorkflowRequestSchema, resumeWorkflowRunRequestSchema, startWorkflowRunRequestSchema, updateWorkflowRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { WorkflowRepository } from "../../workflow/workflow-repository.js";
import type { WorkflowRunRepository } from "../../workflow/workflow-run-repository.js";
import type { WorkflowController } from "../../workflow/workflow-controller.js";

export function registerWorkflowRoutes(
  app: FastifyInstance,
  workflows: WorkflowRepository,
  workflowRuns: WorkflowRunRepository,
  workflowController: WorkflowController,
) {
  app.get<{ Querystring: { workspaceId?: string } }>("/api/workflows", async (request, reply) => {
    if (!request.query.workspaceId) return reply.code(400).send({ message: "workspaceId is required" });
    return workflows.listForWorkspace(request.query.workspaceId);
  });

  app.post("/api/workflows", async (request, reply) => {
    const input = createWorkflowRequestSchema.parse(request.body);
    console.log(`[workflows] creating workflow workspaceId=${input.workspaceId} name=${input.name}`);
    return reply.code(201).send(workflows.add(input));
  });

  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const workflow = workflows.get(request.params.id);
    return workflow ? workflow : reply.code(404).send({ message: "Workflow not found" });
  });

  app.patch<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const input = updateWorkflowRequestSchema.parse(request.body);
    const updated = workflows.update(request.params.id, input);
    return updated ? updated : reply.code(404).send({ message: "Workflow not found" });
  });

  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const removed = workflows.remove(request.params.id);
    return removed
      ? reply.code(204).send()
      : reply.code(404).send({ message: "Workflow not found" });
  });

  app.post<{ Params: { id: string } }>("/api/workflows/:id/runs", async (request, reply) => {
    const input = startWorkflowRunRequestSchema.parse(request.body ?? {});
    try {
      const started = workflowController.start(request.params.id, input.variables);
      return reply.code(202).send(started);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Workflow not found" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/workflows/:id/runs", async (request) => {
    return workflowRuns.listForWorkflow(request.params.id);
  });

  app.get<{ Params: { runId: string } }>("/api/workflow-runs/:runId", async (request, reply) => {
    const run = workflowRuns.get(request.params.runId);
    return run ? run : reply.code(404).send({ message: "Workflow run not found" });
  });

  app.post<{ Params: { runId: string } }>("/api/workflow-runs/:runId/resume", async (request, reply) => {
    const input = resumeWorkflowRunRequestSchema.parse(request.body);
    try {
      workflowController.resume(request.params.runId, input.answer);
      return reply.code(202).send({ accepted: true });
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "Workflow run not found" });
    }
  });

  app.post<{ Params: { runId: string } }>("/api/workflow-runs/:runId/cancel", async (request, reply) => {
    return workflowController.cancel(request.params.runId)
      ? reply.code(202).send({ accepted: true })
      : reply.code(409).send({ message: "Workflow run cannot be cancelled" });
  });

  app.get<{ Querystring: { sessionId?: string } }>("/api/workflow-runs/by-session", async (request, reply) => {
    if (!request.query.sessionId) return reply.code(400).send({ message: "sessionId is required" });
    return workflowRuns.getBySession(request.query.sessionId);
  });
}
