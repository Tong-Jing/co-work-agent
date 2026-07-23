import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { Agent } from "../agent/agent.js";
import { defaultAgentConfig } from "../agent/agent-config.js";
import { ContextBuilder } from "../agent/context-builder.js";
import { ReactLoop } from "../agent/react-loop.js";
import { RunController } from "../agent/run-controller.js";
import { AzureOpenAiProvider } from "../llm/azure-openai-provider.js";
import { AzureEmbeddingProvider } from "../llm/azure-embedding-provider.js";
import { ResilientLlmProvider } from "../llm/resilient-llm-provider.js";
import { AutoMemoryRepository } from "../memory/auto-memory-repository.js";
import { ConversationMemory } from "../memory/conversation-memory.js";
import { LongTermMemory } from "../memory/long-term-memory.js";
import { MemoryRepository } from "../memory/memory-repository.js";
import { MemoryService } from "../memory/memory-service.js";
import { McpClientManager } from "../mcp/mcp-client-manager.js";
import { McpServerRegistry } from "../mcp/mcp-server-registry.js";
import { McpServerRepository } from "../mcp/mcp-server-repository.js";
import { BuiltinMcpOverrideRepository } from "../mcp/builtin-mcp-override-repository.js";
import { builtinMcpServers } from "../mcp/builtin-mcp-servers.js";
import { ApprovalService } from "../permissions/approval-service.js";
import { PermissionPolicy } from "../permissions/permission-policy.js";
import { PermissionService } from "../permissions/permission-service.js";
import { PermissionRuleRepository } from "../permissions/permission-rule-repository.js";
import { BuiltinPermissionRuleOverrideRepository } from "../permissions/builtin-permission-rule-override-repository.js";
import { RunService } from "../sessions/run-service.js";
import { SessionService } from "../sessions/session-service.js";
import { SkillLoader } from "../skills/skill-loader.js";
import { SkillRegistry } from "../skills/skill-registry.js";
import { SkillRepository } from "../skills/skill-repository.js";
import { SkillSelector } from "../skills/skill-selector.js";
import { createDatabase } from "../storage/database.js";
import { createGitTools } from "../tools/local/git-tools.js";
import { createListFilesTool } from "../tools/local/list-files.js";
import { createReadFileTool } from "../tools/local/read-file.js";
import { createRunTaskTool } from "../tools/local/run-task.js";
import { createSearchFilesTool } from "../tools/local/search-files.js";
import { createWriteFileTool } from "../tools/local/write-file.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { ToolExecutor } from "../tools/tool-executor.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { WorkspaceRepository } from "../workspace/workspace-repository.js";
import { WorkflowRepository } from "../workflow/workflow-repository.js";
import { WorkflowRunRepository } from "../workflow/workflow-run-repository.js";
import { WorkflowRunner } from "../workflow/workflow-runner.js";
import { WorkflowController } from "../workflow/workflow-controller.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerAutoMemoryRoutes } from "./routes/auto-memories.js";
import { registerMcpServerRoutes } from "./routes/mcp-servers.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerPermissionRuleRoutes } from "./routes/permission-rules.js";
import { registerToolInfoRoutes } from "./routes/tools.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";

interface BuildAppOptions {
  azureOpenAi: {
    apiKey: string;
    endpoint: string;
    deployment: string;
    apiVersion: string;
  };
  azureEmbedding: {
    apiKey: string;
    endpoint: string;
    deployment: string;
    apiVersion: string;
  };
  workspacesRoot: string;
  webOrigin: string;
  databasePath?: string;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify();
  await app.register(cors, { origin: options.webOrigin, methods: ["GET", "POST"] });

  const database = createDatabase(options.databasePath ?? path.resolve(process.cwd(), "../../.local/agent.db"));
  const workspaceRepository = new WorkspaceRepository(database);
  const workspace = new WorkspaceService(options.workspacesRoot, workspaceRepository);
  await workspace.verify();
  const sessions = new SessionService(database);
  const runs = new RunService(database);
  const approvals = new ApprovalService();
  const permissionRuleRepository = new PermissionRuleRepository(database);
  const builtinPermissionRuleOverrides = new BuiltinPermissionRuleOverrideRepository(database);
  const permissionService = new PermissionService(new PermissionPolicy(), permissionRuleRepository, builtinPermissionRuleOverrides);

  const tools = new ToolRegistry();
  tools.registerAll([
    createListFilesTool(),
    createSearchFilesTool(),
    createReadFileTool(),
    createWriteFileTool(),
    createRunTaskTool(),
    ...createGitTools(),
  ]);

  const mcpServers = new McpServerRegistry();
  const builtinMcpOverrides = new BuiltinMcpOverrideRepository(database);
  for (const server of builtinMcpServers) {
    const override = builtinMcpOverrides.getEnabledOverride(server.id);
    mcpServers.register(override === null ? server : { ...server, enabled: override });
  }
  const mcpServerRepository = new McpServerRepository(database);
  const mcpClients = new McpClientManager(mcpServers);
  tools.registerAll(await mcpClients.discoverTools());

  const skills = new SkillRegistry();
  const skillLoader = new SkillLoader();
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const bundledSkillDirectory = path.resolve(currentDirectory, "../../bundled-skills");
  for (const skill of await skillLoader.loadDirectory(bundledSkillDirectory, "bundled")) skills.register(skill);
  const skillRepository = new SkillRepository(database);
  for (const skill of skillRepository.list()) skills.register({ ...skill, source: "custom" });

  for (const skill of skills.list()) {
    const missingTools = skill.requiredTools.filter((toolName) => !tools.has(toolName));
    if (missingTools.length > 0) {
      console.warn(`[skills] skill "${skill.id}" declares requiredTools not present in the tool registry: ${missingTools.join(", ")}`);
    }
  }

  const memoryRepository = new MemoryRepository(database);
  const llm = new ResilientLlmProvider(new AzureOpenAiProvider(options.azureOpenAi), defaultAgentConfig);
  const embeddings = new AzureEmbeddingProvider(options.azureEmbedding);
  const longTermMemory = new LongTermMemory(memoryRepository, embeddings, llm);
  const autoMemoryRepository = new AutoMemoryRepository(database, longTermMemory, embeddings);
  const memory = new MemoryService(
    new ConversationMemory(sessions),
    longTermMemory,
  );
  const contextBuilder = new ContextBuilder(memory, skills, new SkillSelector());
  const toolExecutor = new ToolExecutor(tools, permissionService, approvals, runs, defaultAgentConfig);
  const loop = new ReactLoop({
    llm,
    tools,
    toolExecutor,
    runs,
    sessions,
    autoMemories: autoMemoryRepository,
  });
  const agent = new Agent(defaultAgentConfig, contextBuilder, loop, runs, workspace);
  const runController = new RunController(agent, runs, sessions);

  const workflowRepository = new WorkflowRepository(database);
  const workflowRunRepository = new WorkflowRunRepository(database);
  const workflowRunner = new WorkflowRunner({
    agent,
    workspaces: workspace,
    tools,
    toolExecutor,
    runs,
    sessions,
    workflows: workflowRepository,
    workflowRuns: workflowRunRepository,
  });
  const workflowController = new WorkflowController(workflowRepository, workflowRunRepository, sessions, workflowRunner, runs);

  app.addHook("onRequest", async (request) => {
    console.log(`[http] ${request.method} ${request.url}`);
  });

  app.get("/api/health", async () => ({ status: "ok", workspacesRoot: workspace.root }));
  registerWorkspaceRoutes(app, workspace);
  registerSessionRoutes(app, sessions, runs, runController);
  registerRunRoutes(app, runs, runController);
  registerApprovalRoutes(app, approvals);
  registerMcpServerRoutes(app, mcpServers, mcpServerRepository, builtinMcpOverrides, mcpClients);
  registerSkillRoutes(app, skills, skillRepository);
  registerMemoryRoutes(app, memoryRepository, longTermMemory);
  registerAutoMemoryRoutes(app, autoMemoryRepository);
  registerPermissionRuleRoutes(app, permissionRuleRepository, builtinPermissionRuleOverrides, permissionService);
  registerToolInfoRoutes(app, tools);
  registerWorkflowRoutes(app, workflowRepository, workflowRunRepository, workflowController);

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    const statusCode = error instanceof Error && error.name === "ZodError" ? 400 : 500;
    console.error(`[http] ${request.method} ${request.url} failed (${statusCode}): ${message}`, error);
    reply.code(statusCode).send({ message });
  });

  app.addHook("onClose", async () => database.close());
  return app;
}
