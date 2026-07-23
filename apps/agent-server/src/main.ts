import { requireAppConfig } from "./config.js";
import { buildApp } from "./server/app.js";

const config = requireAppConfig();
const app = await buildApp(config);
let closing = false;

const close = async (signal: NodeJS.Signals) => {
	if (closing) return;
	closing = true;
	console.log(`[server] received signal ${signal}, shutting down`);
	let exitCode = 0;
	try {
		await app.close();
	} catch (error) {
		console.error("[server] shutdown failed", error);
		exitCode = 1;
	}
	process.exit(exitCode);
};

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try {
	await app.listen({ host: "127.0.0.1", port: config.port });
	console.log(`[server] listening at http://127.0.0.1:${config.port}`);
} catch (error) {
	await app.close();
	if (isAddressInUseError(error)) {
		console.error(`[server] port ${config.port} is already in use; stop the existing Agent server before starting another one`);
		process.exitCode = 1;
	} else {
		throw error;
	}
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}
