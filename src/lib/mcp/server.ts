import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WizardResourceError } from "@/lib/wizard/contracts";
import { PublishSubmissionError } from "@/lib/wizard/publish-submission";
import { WizardRevisionError } from "@/lib/wizard/revision";
import { McpImageImportError } from "./assets/fetch-image";
import type { McpAuthContext } from "./contracts";
import { IdempotencyError, runIdempotent } from "./idempotency";
import { assertMcpToolAccess, McpAccessError } from "./permission-service";
import { consumeMcpRateLimit, McpRateLimitError } from "./rate-limit";
import { MCP_TOOL_CATALOG } from "./tools/catalog";
import { executeDiscoveryTool, type McpToolPayload } from "./tools/discovery";
import { executeReviewPublishTool } from "./tools/review-publish";
import { executeWizardTool } from "./tools/wizard";

type McpToolErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    candidates?: Array<{ id: string; name: string }>;
  };
};

function mapToolError(error: unknown): McpToolErrorBody {
  if (error instanceof McpRateLimitError) {
    return {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "MCP rate limit exceeded",
        retryable: true,
        retryAfterSeconds: error.retryAfterSeconds,
      },
    };
  }
  if (error instanceof IdempotencyError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }
  if (error instanceof WizardResourceError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: false,
        ...(error.candidates.length > 0 ? { candidates: error.candidates } : {}),
      },
    };
  }
  if (error instanceof McpImageImportError) {
    return {
      ok: false,
      error: {
        code: error.code === "UNSUPPORTED_IMAGE" ? "UNSUPPORTED_IMAGE" : "ASSET_URL_FETCH_FAILED",
        message:
          error.code === "UNSUPPORTED_IMAGE"
            ? "URL did not return a supported PNG or JPEG image"
            : "Unable to import the image URL within the configured limits",
        retryable: error.code !== "UNSUPPORTED_IMAGE",
      },
    };
  }
  if (error instanceof WizardRevisionError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message:
          error.code === "REVISION_CONFLICT"
            ? "Wizard changed after review; run review_wizard again"
            : error.message,
        retryable: false,
      },
    };
  }
  if (error instanceof PublishSubmissionError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: false,
      },
    };
  }
  if (error instanceof McpAccessError) {
    const code =
      error.code === "INSUFFICIENT_SCOPE"
        ? "CREDENTIAL_SCOPE_DENIED"
        : error.code === "PROFILE_INACTIVE"
          ? "PROFILE_DISABLED"
          : error.code === "CREDENTIAL_INACTIVE"
            ? "CREDENTIAL_REVOKED"
            : "PERMISSION_DENIED";
    return {
      ok: false,
      error: {
        code,
        message: "Current MCP access does not allow this operation",
        retryable: false,
      },
    };
  }

  const message = error instanceof Error ? error.message : "";
  const code = message.includes("CUSTOM template")
    ? "MOCKUP_SOURCE_MODE_CONFLICT"
    : message.toLowerCase().includes("coverage")
      ? "MOCKUP_COVERAGE_INCOMPLETE"
      : "VALIDATION_FAILED";
  return {
    ok: false,
    error: {
      code,
      message:
        code === "VALIDATION_FAILED"
          ? "The request could not be applied to the current wizard state"
          : message,
      retryable: false,
    },
  };
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  auth: McpAuthContext,
): Promise<McpToolPayload> {
  const discovery = await executeDiscoveryTool(name, args, auth);
  if (discovery) return discovery;
  const wizard = await executeWizardTool(name, args, auth);
  if (wizard) return wizard;
  const reviewPublish = await executeReviewPublishTool(name, args, auth);
  if (reviewPublish) return reviewPublish;
  throw new Error("Tool handler not implemented");
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer({
    name: "mockupai-admin-mcp",
    version: "1.0.0",
  });

  for (const definition of MCP_TOOL_CATALOG) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        annotations: definition.annotations,
      },
      async (rawArgs) => {
        try {
          const args = definition.inputSchema.parse(rawArgs);
          await assertMcpToolAccess(auth, definition.requiredToolGroup);
          await consumeMcpRateLimit(auth.profileId, definition.rateClass);
          const execute = () => dispatchTool(definition.name, args, auth);
          const payload = definition.annotations.readOnlyHint
            ? await execute()
            : await runIdempotent(
                {
                  profileId: auth.profileId,
                  toolName: definition.name,
                  idempotencyKey: String(args.idempotencyKey),
                  normalizedRequest: args,
                },
                execute,
              );
          const response = jsonSafe({
            ok: true as const,
            data: payload.data,
            warnings: payload.warnings,
            nextActions: payload.nextActions,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response) }],
            structuredContent: response,
          };
        } catch (error) {
          const response = mapToolError(error);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response) }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
