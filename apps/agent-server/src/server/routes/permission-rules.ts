import { createPermissionRuleRequestSchema, updatePermissionRuleRequestSchema } from "@local-agent/contracts";
import type { FastifyInstance } from "fastify";
import type { PermissionRuleRepository } from "../../permissions/permission-rule-repository.js";
import type { BuiltinPermissionRuleOverrideRepository } from "../../permissions/builtin-permission-rule-override-repository.js";
import type { PermissionService } from "../../permissions/permission-service.js";
import { builtinPermissionRules } from "../../permissions/permission-rule.js";

const builtinRuleIds = new Set(builtinPermissionRules.map((rule) => rule.id));

export function registerPermissionRuleRoutes(
  app: FastifyInstance,
  rules: PermissionRuleRepository,
  builtinOverrides: BuiltinPermissionRuleOverrideRepository,
  permissions: PermissionService,
) {
  app.get<{ Querystring: { workspaceId?: string } }>("/api/permission-rules", async (request, reply) => {
    if (!request.query.workspaceId) return reply.code(400).send({ message: "workspaceId is required" });
    return permissions.rulesForWorkspace(request.query.workspaceId);
  });

  app.post("/api/permission-rules", async (request, reply) => {
    const input = createPermissionRuleRequestSchema.parse(request.body);
    console.log(`[permission-rules] adding rule workspaceId=${input.workspaceId} tool=${input.toolName} decision=${input.decision}`);
    return reply.code(201).send(rules.add(input));
  });

  app.patch<{ Params: { id: string } }>("/api/permission-rules/:id", async (request, reply) => {
    const input = updatePermissionRuleRequestSchema.parse(request.body);

    if (builtinRuleIds.has(request.params.id)) {
      if (input.enabled === undefined) return reply.code(400).send({ message: "Only 'enabled' can be overridden for builtin rules" });
      builtinOverrides.setEnabled(request.params.id, input.enabled);
      return reply.code(200).send({ id: request.params.id, enabled: input.enabled });
    }

    const updated = rules.update(request.params.id, {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
    });
    return updated
      ? reply.code(200).send({ id: request.params.id, ...input })
      : reply.code(404).send({ message: "Permission rule not found" });
  });

  app.delete<{ Params: { id: string } }>("/api/permission-rules/:id", async (request, reply) => {
    if (builtinRuleIds.has(request.params.id)) {
      return reply.code(400).send({ message: "Builtin rules cannot be deleted; disable them instead" });
    }
    const removed = rules.remove(request.params.id);
    return removed
      ? reply.code(204).send()
      : reply.code(404).send({ message: "Custom permission rule not found" });
  });
}
