import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
loadEnv({ quiet: true });

const configSchema = z.object({
  LLM_PROVIDER: z.literal("azure_responses").default("azure_responses"),
  AZURE_OPENAI_API_KEY: z.string().min(1),
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1),
  AZURE_OPENAI_API_VERSION: z.string().default("2025-04-01-preview"),
  AZURE_EMBEDDING_API_KEY: z.string().min(1).optional(),
  AZURE_EMBEDDING_ENDPOINT: z.string().url().optional(),
  AZURE_EMBEDDING_DEPLOYMENT: z.string().min(1).default("text-embedding-3-small"),
  AZURE_EMBEDDING_API_VERSION: z.string().default("2023-05-15"),
  AGENT_SERVER_PORT: z.coerce.number().int().positive().default(4310),
  WEB_ORIGIN: z.string().url().default("http://127.0.0.1:4311"),
});

const parsed = configSchema.safeParse(process.env);

const configError = parsed.success ? null : parsed.error;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const appConfig = parsed.success
  ? {
      azureOpenAi: {
        apiKey: parsed.data.AZURE_OPENAI_API_KEY,
        endpoint: parsed.data.AZURE_OPENAI_ENDPOINT,
        deployment: parsed.data.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: parsed.data.AZURE_OPENAI_API_VERSION,
      },
      azureEmbedding: {
        apiKey: parsed.data.AZURE_EMBEDDING_API_KEY ?? parsed.data.AZURE_OPENAI_API_KEY,
        endpoint: parsed.data.AZURE_EMBEDDING_ENDPOINT ?? parsed.data.AZURE_OPENAI_ENDPOINT,
        deployment: parsed.data.AZURE_EMBEDDING_DEPLOYMENT,
        apiVersion: parsed.data.AZURE_EMBEDDING_API_VERSION,
      },
      workspacesRoot: path.join(repositoryRoot, "workspaces"),
      port: parsed.data.AGENT_SERVER_PORT,
      webOrigin: parsed.data.WEB_ORIGIN,
    }
  : null;

export function requireAppConfig() {
  if (!appConfig) {
    throw new Error(`Invalid environment configuration: ${configError?.message ?? "unknown error"}`);
  }
  return appConfig;
}
