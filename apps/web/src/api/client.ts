import {
  agentEventSchema,
  autoMemorySchema,
  createMessageResponseSchema,
  mcpServerSchema,
  memorySchema,
  permissionRuleSchema,
  sessionDetailSchema,
  sessionSchema,
  skillSchema,
  startWorkflowRunResponseSchema,
  testMcpConnectionResponseSchema,
  toolInfoSchema,
  workflowDefinitionSchema,
  workflowRunSchema,
  workspaceSchema,
  type AgentEvent,
  type AgentSession,
  type CreateMcpServerRequest,
  type CreateMemoryRequest,
  type CreatePermissionRuleRequest,
  type CreateSkillRequest,
  type CreateWorkflowRequest,
  type CreateWorkspaceRequest,
  type PromoteAutoMemoryRequest,
  type TestMcpConnectionRequest,
  type UpdatePermissionRuleRequest,
  type UpdateSkillRequest,
  type UpdateWorkflowRequest,
} from "@local-agent/contracts";
import { z } from "zod";

const sessionListSchema = z.array(sessionSchema);
const mcpServerListSchema = z.array(mcpServerSchema);
const skillListSchema = z.array(skillSchema);
const workspaceListSchema = z.array(workspaceSchema);
const memoryListSchema = z.array(memorySchema);
const autoMemoryListSchema = z.array(autoMemorySchema);
const permissionRuleListSchema = z.array(permissionRuleSchema);
const toolInfoListSchema = z.array(toolInfoSchema);
const workflowListSchema = z.array(workflowDefinitionSchema);
const workflowRunListSchema = z.array(workflowRunSchema);

async function request(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? response.statusText);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function listSessions(workspaceId: string): Promise<AgentSession[]> {
  return sessionListSchema.parse(await request(`/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}`));
}

export async function createSession(workspaceId: string) {
  return sessionSchema.parse(await request("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ workspaceId }),
  }));
}

export async function getSession(sessionId: string) {
  return sessionDetailSchema.parse(await request(`/api/sessions/${sessionId}`));
}

export async function sendMessage(sessionId: string, content: string) {
  return createMessageResponseSchema.parse(await request(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  }));
}

export async function decideToolCall(callId: string, decision: "allow" | "deny") {
  await request(`/api/tool-calls/${callId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function cancelRun(runId: string) {
  await request(`/api/runs/${runId}/cancel`, { method: "POST", body: "{}" });
}

export function subscribeToRun(runId: string, onEvent: (event: AgentEvent) => void, onError: () => void) {
  const source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (message) => {
    const parsed = agentEventSchema.safeParse(JSON.parse(message.data));
    if (parsed.success) onEvent(parsed.data);
  };
  source.onerror = () => {
    source.close();
    onError();
  };
  return () => source.close();
}

export async function listMcpServers() {
  return mcpServerListSchema.parse(await request("/api/mcp-servers"));
}

export async function createMcpServer(input: CreateMcpServerRequest) {
  return mcpServerSchema.parse(await request("/api/mcp-servers", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function deleteMcpServer(id: string) {
  await request(`/api/mcp-servers/${id}`, { method: "DELETE" });
}

export async function toggleMcpServer(id: string, enabled: boolean) {
  await request(`/api/mcp-servers/${id}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function testMcpConnection(input: TestMcpConnectionRequest) {
  return testMcpConnectionResponseSchema.parse(await request("/api/mcp-servers/test", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function listSkills() {
  return skillListSchema.parse(await request("/api/skills"));
}

export async function createSkill(input: CreateSkillRequest) {
  return skillSchema.parse(await request("/api/skills", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function deleteSkill(id: string) {
  await request(`/api/skills/${id}`, { method: "DELETE" });
}

export async function updateSkill(id: string, input: UpdateSkillRequest) {
  return skillSchema.parse(await request(`/api/skills/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }));
}

export async function listWorkspaces() {
  return workspaceListSchema.parse(await request("/api/workspaces"));
}

export async function createWorkspace(input: CreateWorkspaceRequest) {
  return workspaceSchema.parse(await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function listMemories() {
  return memoryListSchema.parse(await request("/api/memories"));
}

export async function createMemory(input: CreateMemoryRequest) {
  return memorySchema.parse(await request("/api/memories", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function deleteMemory(id: string) {
  await request(`/api/memories/${id}`, { method: "DELETE" });
}

export async function listArchivedMemories() {
  return memoryListSchema.parse(await request("/api/memories/archived"));
}

export async function restoreMemory(id: string) {
  return request(`/api/memories/${id}/restore`, { method: "POST" });
}

export async function listAutoMemories() {
  return autoMemoryListSchema.parse(await request("/api/auto-memories"));
}

export async function promoteAutoMemory(id: string, input: PromoteAutoMemoryRequest) {
  return memorySchema.parse(await request(`/api/auto-memories/${id}/promote`, {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function deleteAutoMemory(id: string) {
  await request(`/api/auto-memories/${id}`, { method: "DELETE" });
}

export async function listPermissionRules(workspaceId: string) {
  return permissionRuleListSchema.parse(await request(`/api/permission-rules?workspaceId=${encodeURIComponent(workspaceId)}`));
}

export async function createPermissionRule(input: CreatePermissionRuleRequest) {
  return permissionRuleSchema.parse(await request("/api/permission-rules", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function updatePermissionRule(id: string, input: UpdatePermissionRuleRequest) {
  return request(`/api/permission-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deletePermissionRule(id: string) {
  await request(`/api/permission-rules/${id}`, { method: "DELETE" });
}

export async function listTools() {
  return toolInfoListSchema.parse(await request("/api/tools"));
}

export async function listWorkflows(workspaceId: string) {
  return workflowListSchema.parse(await request(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`));
}

export async function createWorkflow(input: CreateWorkflowRequest) {
  return workflowDefinitionSchema.parse(await request("/api/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function updateWorkflow(id: string, input: UpdateWorkflowRequest) {
  return workflowDefinitionSchema.parse(await request(`/api/workflows/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }));
}

export async function deleteWorkflow(id: string) {
  await request(`/api/workflows/${id}`, { method: "DELETE" });
}

export async function startWorkflowRun(id: string, variables: Record<string, string> = {}) {
  return startWorkflowRunResponseSchema.parse(await request(`/api/workflows/${id}/runs`, {
    method: "POST",
    body: JSON.stringify({ variables }),
  }));
}

export async function listWorkflowRuns(workflowId: string) {
  return workflowRunListSchema.parse(await request(`/api/workflows/${workflowId}/runs`));
}

export async function getWorkflowRun(runId: string) {
  return workflowRunSchema.parse(await request(`/api/workflow-runs/${runId}`));
}

export async function resumeWorkflowRun(runId: string, answer: string) {
  await request(`/api/workflow-runs/${runId}/resume`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

export async function getWorkflowRunBySession(sessionId: string) {
  const response = await fetch(`/api/workflow-runs/by-session?sessionId=${encodeURIComponent(sessionId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to load workflow run for session: ${response.statusText}`);
  return workflowRunSchema.parse(await response.json());
}
