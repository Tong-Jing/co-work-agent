# Co-Work Agent

Co-Work Agent is a locally running AI agent that interacts with users through a web interface. It can operate within a configured local workspace, retain memory across interactions, and run custom workflows.

## Features

- Chat-based agent runs with a visible event timeline
- Workspace-scoped file, task, and Git tools
- Approval policies and configurable permission rules
- Built-in and custom skills
- Built-in and custom MCP server integrations
- Conversation, long-term, and automatically captured memory
- Reusable multi-step workflows
- Local SQLite persistence

## Requirements

- Node.js 22.13 or later
- npm 10 or later
- An Azure OpenAI resource with:
  - A model deployment that supports the Responses API
  - An embeddings deployment, such as `text-embedding-3-small`

## Quick Start

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create a local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set the required values in `.env`:

   ```dotenv
   AZURE_OPENAI_API_KEY=your-api-key
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
   AZURE_OPENAI_DEPLOYMENT=your-model-deployment
   ```

4. Start the web app and agent server:

   ```powershell
   npm run dev
   ```

5. Open <http://127.0.0.1:4311>.

The API listens on <http://127.0.0.1:4310>. To verify it is running, request <http://127.0.0.1:4310/api/health>.

## Configuration

The server reads `.env` from the repository root.

| Variable                      | Required | Default                  | Description                                                |
| ----------------------------- | -------- | ------------------------ | ---------------------------------------------------------- |
| `LLM_PROVIDER`                | No       | `azure_responses`        | LLM provider; currently only Azure Responses is supported. |
| `AZURE_OPENAI_API_KEY`        | Yes      | -                        | Azure OpenAI API key.                                      |
| `AZURE_OPENAI_ENDPOINT`       | Yes      | -                        | Azure OpenAI resource endpoint.                            |
| `AZURE_OPENAI_DEPLOYMENT`     | Yes      | -                        | Model deployment used for agent responses.                 |
| `AZURE_OPENAI_API_VERSION`    | No       | `2025-04-01-preview`     | Responses API version.                                     |
| `AZURE_EMBEDDING_API_KEY`     | No       | OpenAI API key           | Separate key for the embeddings deployment.                |
| `AZURE_EMBEDDING_ENDPOINT`    | No       | OpenAI endpoint          | Separate endpoint for the embeddings deployment.           |
| `AZURE_EMBEDDING_DEPLOYMENT`  | No       | `text-embedding-3-small` | Embeddings deployment name.                                |
| `AZURE_EMBEDDING_API_VERSION` | No       | `2023-05-15`             | Embeddings API version.                                    |
| `AGENT_SERVER_PORT`           | No       | `4310`                   | Local API port.                                            |
| `WEB_ORIGIN`                  | No       | `http://127.0.0.1:4311`  | Allowed browser origin for CORS.                           |

The application manages projects under `workspaces/`. Each Workspace has its own physical directory and task working directory, and can contain its own Git working tree. Sessions, memories, permissions, and workflows are scoped to the same Workspace. The directory is created automatically when a Workspace is created in the web interface.

## Project Structure

```text
apps/
  agent-server/       Fastify API, agent loop, tools, memory, and workflows
  web/                React and Vite control surface
packages/
  contracts/          Shared API schemas and TypeScript contracts
skill-evaluations/    Skill evaluation scenarios
```

The web development server proxies `/api` requests to the agent server. Application state is stored in `.local/agent.db`; managed projects are stored under `workspaces/`. Both directories are ignored by Git.

## Development

Run all commands from the repository root.

```powershell
# Run the web app and API in watch mode
npm run dev

# Build all workspaces
npm run build

# Type-check all workspaces
npm run typecheck

# Run all tests
npm test
```

Workspace-specific commands can be run with npm's `--workspace` option. For example:

```powershell
npm test --workspace @local-agent/server
```

## Local Data and Secrets

- Keep Azure credentials in `.env`; it is excluded from source control.
- Local sessions, memories, permissions, MCP settings, skills, and workflows are stored under `.local/`.
- Do not commit database files, local run artifacts, or personal agent configuration.
