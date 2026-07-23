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

const runStateSchema = z.object({
  id: z.string(),
  status: z.enum(["created", "running", "completed", "failed", "cancelled", "interrupted"]),
  lastSequence: z.number(),
});

export function subscribeToRun(
  runId: string,
  onEvent: (event: AgentEvent) => void,
  onConnectionChange: (status: "connecting" | "connected" | "reconnecting" | "disconnected") => void,
  onReconciled: (status: "completed" | "failed" | "cancelled" | "interrupted") => void,
) {
  const controller = new AbortController();
  let cursor = 0;

  void (async () => {
    for (let attempt = 0; !controller.signal.aborted; attempt += 1) {
      onConnectionChange(attempt === 0 ? "connecting" : "reconnecting");
      try {
        const response = await fetch(`/api/runs/${runId}/events`, {
          ...(cursor > 0 ? { headers: { "Last-Event-ID": String(cursor) } } : {}),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Run event stream failed with ${response.status}`);
        onConnectionChange("connected");
        await readEventStream(response.body, (id, data) => {
          const parsed = agentEventSchema.safeParse(JSON.parse(data));
          if (!parsed.success) return;
          cursor = Math.max(cursor, Number.parseInt(id, 10) || parsed.data.sequence);
          onEvent(parsed.data);
        }, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn(`[api] run stream disconnected runId=${runId} attempt=${attempt + 1}`, error);
      }

      const state = runStateSchema.parse(await request(`/api/runs/${runId}`));
      if (["completed", "failed", "cancelled", "interrupted"].includes(state.status)) {
        onReconciled(state.status as "completed" | "failed" | "cancelled" | "interrupted");
        onConnectionChange("disconnected");
        return;
      }
      if (attempt >= 5) {
        onConnectionChange("disconnected");
        return;
      }
      await abortableDelay(Math.min(1000 * 2 ** attempt, 10_000), controller.signal);
    }
  })().catch((error) => {
    if (!controller.signal.aborted) {
      console.error(`[api] run subscription failed runId=${runId}`, error);
      onConnectionChange("disconnected");
    }
  });

  return () => controller.abort();
}

async function readEventStream(stream: ReadableStream<Uint8Array>, onMessage: (id: string, data: string) => void, signal: AbortSignal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const id = block.split("\n").find((line) => line.startsWith("id:"))?.slice(3).trim() ?? "";
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) onMessage(id, data);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
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
  return workflowRunSchema.nullable().parse(
    await request(`/api/workflow-runs/by-session?sessionId=${encodeURIComponent(sessionId)}`),
  );
}
