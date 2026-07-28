import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateMcpRevisionSecret } from "@/lib/wizard/revision";
import { cleanupMcpTemporaryAssets } from "./assets/cleanup";
import type { McpAuthContext } from "./contracts";
import { verifyPersonalAccessToken } from "./credential-service";
import { verifyOAuthAccessToken } from "./oauth-service";
import { createMcpServer } from "./server";

const MAX_MCP_BODY_BYTES = 1024 * 1024;

type RequestSourcePolicy = {
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
};

type McpTokenVerifiers = {
  verifyPat(token: string): Promise<McpAuthContext>;
  verifyOAuth(token: string): Promise<McpAuthContext>;
};

export class McpHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "McpHttpError";
  }
}

export function createMcpAuthenticator(verifiers: McpTokenVerifiers) {
  return async function authenticate(authorization: string | undefined): Promise<McpAuthContext> {
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match) {
      throw unauthorized();
    }
    const token = match[1];
    try {
      if (token.startsWith("mcp_pat_")) {
        return await verifiers.verifyPat(token);
      }
      if (token.startsWith("mcp_oauth_at_")) {
        return await verifiers.verifyOAuth(token);
      }
    } catch {
      throw unauthorized();
    }
    throw unauthorized();
  };
}

function unauthorized(): McpHttpError {
  return new McpHttpError(401, "Unauthorized", {
    "WWW-Authenticate": "Bearer",
  });
}

export function validateMcpRequestSource(
  source: { host: string | undefined; origin: string | undefined },
  policy: RequestSourcePolicy,
): void {
  if (!source.host || !policy.allowedHosts.has(source.host.toLowerCase())) {
    throw new McpHttpError(421, "Unapproved MCP Host");
  }
  if (source.origin && !policy.allowedOrigins.has(normalizeOrigin(source.origin))) {
    throw new McpHttpError(403, "Unapproved MCP Origin");
  }
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function csvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function requestPolicy(): RequestSourcePolicy {
  const publicUrl = new URL(process.env.APP_PUBLIC_URL ?? "http://localhost:3000");
  const allowedHosts = csvSet(process.env.MCP_ALLOWED_HOSTS);
  allowedHosts.add(publicUrl.host.toLowerCase());
  const allowedOrigins = csvSet(process.env.MCP_ALLOWED_ORIGINS);
  allowedOrigins.add(publicUrl.origin.toLowerCase());
  return { allowedHosts, allowedOrigins };
}

async function parseJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_MCP_BODY_BYTES) {
      throw new McpHttpError(413, "MCP request body exceeds 1 MB");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new McpHttpError(400, "MCP request body must be valid JSON");
  }
}

function writeError(response: ServerResponse, error: unknown): void {
  const httpError =
    error instanceof McpHttpError ? error : new McpHttpError(500, "Internal MCP server error");
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(httpError.status, {
    "Content-Type": "application/json",
    ...httpError.headers,
  });
  response.end(
    JSON.stringify({
      error: httpError.message,
    }),
  );
}

const authenticateBearer = createMcpAuthenticator({
  verifyPat: verifyPersonalAccessToken,
  verifyOAuth: verifyOAuthAccessToken,
});

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", process.env.APP_PUBLIC_URL ?? "http://localhost:3000");
    if (url.pathname !== "/mcp") {
      throw new McpHttpError(404, "Not found");
    }
    validateMcpRequestSource(
      {
        host: request.headers.host,
        origin: request.headers.origin,
      },
      requestPolicy(),
    );
    if (request.method !== "POST") {
      throw new McpHttpError(405, "Method not allowed", {
        Allow: "POST",
      });
    }
    const auth = await authenticateBearer(request.headers.authorization);
    const body = await parseJsonBody(request);
    const mcpServer = createMcpServer(auth);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([mcpServer.close(), transport.close()]);
    };
    response.once("close", () => void close());
    response.once("finish", () => void close());
    await mcpServer.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    writeError(response, error);
  }
}

export function startMcpHttpServer(input?: { port?: number; host?: string }): {
  close(): Promise<void>;
} {
  if (
    process.env.NODE_ENV === "production" &&
    [process.env.MCP_ALLOWED_HOSTS, process.env.MCP_ALLOWED_ORIGINS].some((value) =>
      value?.split(",").some((entry) => entry.trim() === "*"),
    )
  ) {
    throw new Error("Wildcard MCP host/origin values are forbidden in production");
  }
  if (process.env.NODE_ENV === "production") {
    validateMcpRevisionSecret();
  }
  const server = createServer((request, response) => {
    void handleMcpRequest(request, response);
  });
  let cleanupInFlight: Promise<void> | null = null;
  const runCleanup = () => {
    if (cleanupInFlight) return cleanupInFlight;
    cleanupInFlight = cleanupMcpTemporaryAssets()
      .then((result) => {
        if (
          result.designsDeleted > 0 ||
          result.mockupsDeleted > 0 ||
          result.storageErrors.length > 0
        ) {
          console.info("[MCP cleanup]", result);
        }
      })
      .catch((error) => {
        console.error("[MCP cleanup] Failed:", error);
      })
      .finally(() => {
        cleanupInFlight = null;
      });
    return cleanupInFlight;
  };
  server.listen(
    input?.port ?? Number(process.env.MCP_PORT ?? 3101),
    input?.host ?? process.env.MCP_HOST ?? "127.0.0.1",
  );
  void runCleanup();
  const cleanupInterval = setInterval(
    () => {
      void runCleanup();
    },
    60 * 60 * 1000,
  );
  cleanupInterval.unref();
  return {
    close: async () => {
      clearInterval(cleanupInterval);
      await cleanupInFlight;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
