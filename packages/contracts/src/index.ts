import { z } from "zod";

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  directoryName: z.string(),
  createdAt: z.string(),
});

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const messageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});

export const sessionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started"), runId: z.string(), sequence: z.number() }),
  z.object({
    type: z.literal("context.gathered"),
    memoryCount: z.number(),
    skillCount: z.number(),
    historyCount: z.number(),
    sequence: z.number(),
  }),
  z.object({ type: z.literal("status"), label: z.string(), sequence: z.number() }),
  z.object({ type: z.literal("message.delta"), text: z.string(), sequence: z.number() }),
  z.object({
    type: z.literal("tool.requested"),
    callId: z.string(),
    tool: z.string(),
    source: z.enum(["local", "mcp"]),
    mcpServer: z.string().optional(),
    arguments: z.string(),
    summary: z.string(),
    sequence: z.number(),
  }),
  z.object({
    type: z.literal("approval.required"),
    callId: z.string(),
    tool: z.string(),
    summary: z.string(),
    risk: z.enum(["medium", "high"]),
    matchedRuleId: z.string().nullable().optional(),
    sequence: z.number(),
  }),
  z.object({
    type: z.literal("tool.denied"),
    callId: z.string(),
    tool: z.string(),
    reason: z.string(),
    matchedRuleId: z.string().nullable().optional(),
    sequence: z.number(),
  }),
  z.object({
    type: z.literal("tool.completed"),
    callId: z.string(),
    tool: z.string(),
    result: z.string(),
    summary: z.string(),
    sequence: z.number(),
  }),
  z.object({ type: z.literal("file.diff"), path: z.string(), patch: z.string(), sequence: z.number() }),
  z.object({ type: z.literal("run.completed"), sequence: z.number() }),
  z.object({ type: z.literal("run.cancelled"), sequence: z.number() }),
  z.object({ type: z.literal("run.failed"), message: z.string(), sequence: z.number() }),
]);

export const runEventLogSchema = z.object({
  runId: z.string(),
  events: z.array(agentEventSchema),
});

export const sessionDetailSchema = sessionSchema.extend({
  messages: z.array(messageSchema.extend({ runId: z.string().nullable() })),
  runs: z.array(runEventLogSchema),
});


export const createMessageRequestSchema = z.object({ content: z.string().trim().min(1).max(20_000) });
export const createMessageResponseSchema = z.object({ runId: z.string() });
export const createSessionRequestSchema = z.object({
  workspaceId: z.string(),
  title: z.string().trim().min(1).max(120).optional(),
});
export const approvalDecisionSchema = z.object({ decision: z.enum(["allow", "deny"]) });

export const mcpConnectionStateSchema = z.enum(["connected", "failed", "untested"]);

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  enabled: z.boolean(),
  source: z.enum(["builtin", "custom"]),
  createdAt: z.string(),
  connectionState: mcpConnectionStateSchema,
  toolNames: z.array(z.string()),
  errorMessage: z.string().nullable(),
});

export const createMcpServerRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    name: z.string().trim().min(1).max(120),
    command: z.string().trim().min(1).max(500),
    args: z.array(z.string().trim().min(1)).default([]),
    enabled: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("http"),
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().url().max(500),
    enabled: z.boolean().default(true),
  }),
]);

export const testMcpConnectionRequestSchema = createMcpServerRequestSchema;

export const testMcpConnectionResponseSchema = z.object({
  success: z.boolean(),
  toolCount: z.number(),
  toolNames: z.array(z.string()),
  errorMessage: z.string().nullable(),
});

export const skillRiskSchema = z.enum(["low", "medium", "high"]);

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  source: z.enum(["bundled", "custom"]),
  createdAt: z.string(),
  version: z.string(),
  taskTypes: z.array(z.string()),
  requiredTools: z.array(z.string()),
  risk: skillRiskSchema,
});

export const createSkillRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  instructions: z.string().trim().min(1).max(20_000),
  version: z.string().trim().min(1).max(40).default("1.0.0"),
  taskTypes: z.array(z.string().trim().min(1).max(60)).default([]),
  requiredTools: z.array(z.string().trim().min(1).max(120)).default([]),
  risk: skillRiskSchema.default("low"),
});

export const updateSkillRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  instructions: z.string().trim().min(1).max(20_000).optional(),
  version: z.string().trim().min(1).max(40).optional(),
  taskTypes: z.array(z.string().trim().min(1).max(60)).optional(),
  requiredTools: z.array(z.string().trim().min(1).max(120)).optional(),
  risk: skillRiskSchema.optional(),
});

export const memorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  category: z.string(),
  content: z.string(),
  createdAt: z.string(),
  status: z.enum(["active", "superseded"]),
  supersededBy: z.string().nullable(),
  lastRecalledAt: z.string().nullable(),
  recallCount: z.number(),
});

export const createMemoryRequestSchema = z.object({
  workspaceId: z.string(),
  category: z.string().trim().min(1).max(60),
  content: z.string().trim().min(1).max(2_000),
});

export const autoMemorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  sessionId: z.string(),
  runId: z.string(),
  content: z.string(),
  sharedMemoryId: z.string().nullable(),
  createdAt: z.string(),
  hitCount: z.number(),
});

export const promoteAutoMemoryRequestSchema = z.object({
  category: z.string().trim().min(1).max(60),
});

export const permissionDecisionValueSchema = z.enum(["allow", "deny", "ask"]);

export const permissionMatcherSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("path"), pattern: z.string().trim().min(1).max(300) }),
  z.object({
    kind: z.literal("arg"),
    field: z.string().trim().min(1).max(100),
    values: z.array(z.string().trim().min(1).max(300)).min(1),
  }),
]);

export const permissionRuleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  toolName: z.string(),
  matcher: permissionMatcherSchema,
  decision: permissionDecisionValueSchema,
  priority: z.number(),
  enabled: z.boolean(),
  source: z.enum(["builtin", "custom"]),
  createdAt: z.string(),
});

export const createPermissionRuleRequestSchema = z.object({
  workspaceId: z.string(),
  toolName: z.string().trim().min(1).max(120),
  matcher: permissionMatcherSchema,
  decision: permissionDecisionValueSchema,
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
});

export const updatePermissionRuleRequestSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  decision: permissionDecisionValueSchema.optional(),
});

export const toolInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  inputFields: z.array(z.string()),
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("prompt"), label: z.string(), promptTemplate: z.string().min(1), outputVariable: z.string().min(1) }),
  z.object({ id: z.string(), type: z.literal("skill"), label: z.string(), skillId: z.string().min(1), outputVariable: z.string().min(1) }),
  z.object({
    id: z.string(),
    type: z.literal("tool"),
    label: z.string(),
    toolName: z.string().min(1),
    argsTemplate: z.record(z.string(), z.string()),
    outputVariable: z.string().min(1),
  }),
  z.object({ id: z.string(), type: z.literal("user_input"), label: z.string(), question: z.string().min(1), outputVariable: z.string().min(1) }),
]);

export const workflowDefinitionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  nodes: z.array(workflowNodeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createWorkflowRequestSchema = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  version: z.string().trim().min(1).max(40).default("1.0.0"),
  nodes: z.array(workflowNodeSchema).default([]),
});

export const updateWorkflowRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  version: z.string().trim().min(1).max(40).optional(),
  nodes: z.array(workflowNodeSchema).optional(),
});

export const workflowNodeStateSchema = z.object({
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  output: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const workflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  sessionId: z.string(),
  status: z.enum(["running", "waiting-input", "completed", "failed", "cancelled"]),
  currentNodeId: z.string().nullable(),
  nodeStates: z.record(z.string(), workflowNodeStateSchema),
  variables: z.record(z.string(), z.string()),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});

export const startWorkflowRunRequestSchema = z.object({
  variables: z.record(z.string(), z.string()).default({}),
});

export const startWorkflowRunResponseSchema = z.object({
  workflowRunId: z.string(),
  sessionId: z.string(),
});

export const resumeWorkflowRunRequestSchema = z.object({
  answer: z.string().trim().min(1).max(20_000),
});

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type RunEventLog = z.infer<typeof runEventLogSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type AgentMessage = z.infer<typeof messageSchema>;
export type AgentSession = z.infer<typeof sessionSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;
export type CreateMessageResponse = z.infer<typeof createMessageResponseSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type McpServerEntry = z.infer<typeof mcpServerSchema>;
export type CreateMcpServerRequest = z.infer<typeof createMcpServerRequestSchema>;
export type McpConnectionState = z.infer<typeof mcpConnectionStateSchema>;
export type TestMcpConnectionRequest = z.infer<typeof testMcpConnectionRequestSchema>;
export type TestMcpConnectionResponse = z.infer<typeof testMcpConnectionResponseSchema>;
export type PermissionDecisionValue = z.infer<typeof permissionDecisionValueSchema>;
export type PermissionMatcher = z.infer<typeof permissionMatcherSchema>;
export type PermissionRuleEntry = z.infer<typeof permissionRuleSchema>;
export type CreatePermissionRuleRequest = z.infer<typeof createPermissionRuleRequestSchema>;
export type UpdatePermissionRuleRequest = z.infer<typeof updatePermissionRuleRequestSchema>;
export type ToolInfo = z.infer<typeof toolInfoSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;
export type WorkflowNodeState = z.infer<typeof workflowNodeStateSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type StartWorkflowRunRequest = z.infer<typeof startWorkflowRunRequestSchema>;
export type StartWorkflowRunResponse = z.infer<typeof startWorkflowRunResponseSchema>;
export type ResumeWorkflowRunRequest = z.infer<typeof resumeWorkflowRunRequestSchema>;
export type SkillEntry = z.infer<typeof skillSchema>;
export type CreateSkillRequest = z.infer<typeof createSkillRequestSchema>;
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;
export type SkillRisk = z.infer<typeof skillRiskSchema>;
export type MemoryEntry = z.infer<typeof memorySchema>;
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;
export type AutoMemoryEntry = z.infer<typeof autoMemorySchema>;
export type PromoteAutoMemoryRequest = z.infer<typeof promoteAutoMemoryRequestSchema>;
