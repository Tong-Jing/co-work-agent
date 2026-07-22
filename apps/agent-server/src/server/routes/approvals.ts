import { approvalDecisionSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { ApprovalService } from "../../permissions/approval-service.js";

export function registerApprovalRoutes(app: FastifyInstance, approvals: ApprovalService) {
  app.post<{ Params: { callId: string } }>("/api/tool-calls/:callId/decision", async (request, reply) => {
    const input = approvalDecisionSchema.parse(request.body);
    return approvals.decide(request.params.callId, input.decision)
      ? reply.code(202).send({ accepted: true })
      : reply.code(404).send({ message: "Pending approval not found" });
  });
}
