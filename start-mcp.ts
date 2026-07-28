import "dotenv/config";
import { startMcpHttpServer } from "./src/lib/mcp/http-server";

const runtime = startMcpHttpServer({
  host: process.env.MCP_HOST ?? "127.0.0.1",
  port: Number(process.env.MCP_PORT ?? "3101"),
});

async function shutdown() {
  await runtime.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
