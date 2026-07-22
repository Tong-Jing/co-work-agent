import type { WorkflowRunner } from "./workflow-runner.js";
import type { WorkflowRepository } from "./workflow-repository.js";
import type { WorkflowRunRepository } from "./workflow-run-repository.js";
import type { SessionService } from "../sessions/session-service.js";

export class WorkflowController {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly workflowRuns: WorkflowRunRepository,
    private readonly sessions: SessionService,
    private readonly runner: WorkflowRunner,
  ) {}

  start(workflowId: string, variables: Record<string, string>) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error("Workflow not found");

    const existingRuns = this.workflowRuns.listForWorkflow(workflowId);
    const title = `Workflow: ${workflow.name} #${existingRuns.length + 1}`;
    const session = this.sessions.create(workflow.workspaceId, title);
    const workflowRun = this.workflowRuns.create(workflowId, session.id);

    console.log(`[workflow-controller] starting workflow run workflowRunId=${workflowRun.id} workflowId=${workflowId} sessionId=${session.id}`);
    void this.runner.run(workflowRun.id, workflow.workspaceId, variables).catch((error) => {
      console.error(`[workflow-controller] workflow run threw unexpectedly workflowRunId=${workflowRun.id}`, error);
    });

    return { workflowRunId: workflowRun.id, sessionId: session.id };
  }

  resume(workflowRunId: string, answer: string) {
    const run = this.workflowRuns.get(workflowRunId);
    if (!run) throw new Error("Workflow run not found");
    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) throw new Error("Workflow not found");

    console.log(`[workflow-controller] resuming workflow run workflowRunId=${workflowRunId}`);
    void this.runner.resume(workflowRunId, workflow.workspaceId, answer).catch((error) => {
      console.error(`[workflow-controller] workflow run resume threw unexpectedly workflowRunId=${workflowRunId}`, error);
    });
  }
}
