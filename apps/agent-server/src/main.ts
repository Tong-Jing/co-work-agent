import { requireAppConfig } from "./config.js";
import { buildApp } from "./server/app.js";

const config = requireAppConfig();
const app = await buildApp(config);

await app.listen({ host: "127.0.0.1", port: config.port });
