import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type CliOptions = {
  baseUrl: string;
  tokenEnv: string;
  imageUrl: string;
  storeId?: string;
  publish: boolean;
  pollSeconds: number;
};

type ToolEnvelope = {
  ok: boolean;
  data?: Record<string, unknown>;
  warnings?: string[];
  nextActions?: string[];
  error?: { code?: string; message?: string };
};

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let publish = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--publish") {
      publish = true;
      continue;
    }
    if (arg === "--token" || arg.startsWith("--token=")) {
      throw new Error("--token is forbidden; pass only --token-env <ENV_NAME>");
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    values.set(arg, value);
    index += 1;
  }

  const baseUrl = values.get("--base-url");
  const tokenEnv = values.get("--token-env");
  const imageUrl = values.get("--image-url");
  if (!baseUrl || !tokenEnv || !imageUrl) {
    throw new Error(
      "Required: --base-url <.../mcp> --token-env <ENV_NAME> --image-url <PNG_OR_JPEG_URL>",
    );
  }
  const parsedBaseUrl = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new Error("Base URL must use HTTP or HTTPS");
  }
  const parsedImageUrl = new URL(imageUrl);
  if (!["http:", "https:"].includes(parsedImageUrl.protocol)) {
    throw new Error("Image URL must use HTTP or HTTPS");
  }
  const pollSeconds = Number(values.get("--poll-seconds") ?? 60);
  if (!Number.isFinite(pollSeconds) || pollSeconds < 0 || pollSeconds > 600) {
    throw new Error("--poll-seconds must be between 0 and 600");
  }
  return {
    baseUrl: parsedBaseUrl.toString(),
    tokenEnv,
    imageUrl: parsedImageUrl.toString(),
    storeId: values.get("--store-id"),
    publish,
    pollSeconds,
  };
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolEnvelope> {
  const result = await client.callTool({ name, arguments: args });
  let envelope = result.structuredContent as ToolEnvelope | undefined;
  if (!envelope) {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find(
      (item): item is { type: "text"; text: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    );
    if (text?.type === "text") {
      envelope = JSON.parse(text.text) as ToolEnvelope;
    }
  }
  if (!envelope) throw new Error(`${name} returned no structured result`);
  if (result.isError || !envelope.ok) {
    const code = envelope.error?.code ?? "TOOL_ERROR";
    const message = envelope.error?.message ?? "Tool call failed";
    throw new Error(`${name}: ${code}: ${message}`);
  }
  return envelope;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const secret = process.env[options.tokenEnv];
  if (!secret) {
    throw new Error(`Environment variable ${options.tokenEnv} is empty`);
  }
  if (options.publish && process.env.MCP_SMOKE_ALLOW_PUBLISH !== "1") {
    throw new Error(
      "Publishing requires both --publish and MCP_SMOKE_ALLOW_PUBLISH=1",
    );
  }

  const client = new Client({
    name: "mockupai-mcp-smoke",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(options.baseUrl),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${secret}` },
      },
    },
  );

  try {
    console.info(`[connect] ${redactUrl(options.baseUrl)}`);
    await client.connect(transport);
    console.info("[initialize] ok");

    const listed = await client.listTools();
    if (listed.tools.length !== 16) {
      throw new Error(`Expected 16 tools, received ${listed.tools.length}`);
    }
    console.info(`[tools/list] ${listed.tools.length} tools`);

    const storesResult = await callTool(client, "list_stores", {
      status: "ACTIVE",
      limit: 100,
    });
    const stores = arrayValue(storesResult.data?.stores);
    const store =
      (options.storeId
        ? stores.find((candidate) => candidate.id === options.storeId)
        : stores[0]) ?? null;
    if (!store || typeof store.id !== "string") {
      throw new Error("No matching active store is available for smoke");
    }
    console.info(`[list_stores] selected ${String(store.name)} (${store.id})`);

    const configResult = await callTool(client, "get_store_wizard_config", {
      storeRef: { id: store.id },
    });
    const config = objectValue(configResult.data?.config);
    const templates = arrayValue(config.templates);
    const colors = arrayValue(config.colors);
    const template =
      templates.find(
        (candidate) =>
          candidate.defaultMockupSource === "PRINTIFY" && candidate.isDefault,
      ) ??
      templates.find(
        (candidate) => candidate.defaultMockupSource === "PRINTIFY",
      ) ??
      templates.find((candidate) => candidate.isDefault) ??
      templates[0];
    console.info(
      `[get_store_wizard_config] ${templates.length} templates, ${colors.length} colors`,
    );

    const productConfig: Record<string, unknown> = {};
    if (typeof template?.id === "string") {
      productConfig.templateRef = { id: template.id };
    }
    const colorIds = colors
      .map((color) => color.id)
      .filter((id): id is string => typeof id === "string");
    if (colorIds.length > 0) productConfig.enabledColorIds = colorIds;

    const created = await callTool(client, "create_listing_wizard", {
      storeRef: { id: store.id },
      designUrls: [
        {
          url: options.imageUrl,
          name: `MCP Smoke ${new Date().toISOString().slice(0, 10)}`,
        },
      ],
      ...(Object.keys(productConfig).length > 0 ? { productConfig } : {}),
      pairingMode: "AUTO",
      idempotencyKey: `smoke-create-${randomUUID()}`,
    });
    const wizard = objectValue(created.data);
    const draft = objectValue(wizard.draft);
    const draftId = draft.id;
    if (typeof draftId !== "string") {
      throw new Error("create_listing_wizard did not return draft.id");
    }
    console.info(
      `[create_listing_wizard] draft=${draftId} image=${redactUrl(options.imageUrl)}`,
    );

    const pairs = arrayValue(wizard.designPairs);
    const designs = arrayValue(wizard.designs);
    const target =
      typeof pairs[0]?.id === "string"
        ? { type: "PAIR", pairId: pairs[0].id }
        : typeof designs[0]?.draftDesignId === "string"
          ? { type: "DESIGN", draftDesignId: designs[0].draftDesignId }
          : null;
    if (!target) throw new Error("Wizard has no content target");
    await callTool(client, "set_wizard_content", {
      draftId,
      target,
      content: {
        title: `MCP Smoke ${new Date().toISOString()}`,
        description: "Non-production MCP protocol smoke fixture.",
        tags: ["mcp-smoke"],
      },
      idempotencyKey: `smoke-content-${randomUUID()}`,
    });
    console.info("[set_wizard_content] ok");

    try {
      await callTool(client, "generate_wizard_assets", {
        draftId,
        assetTypes: ["MOCKUPS"],
        force: false,
        idempotencyKey: `smoke-generate-${randomUUID()}`,
      });
      console.info("[generate_wizard_assets] started");
    } catch (error) {
      console.warn(
        `[generate_wizard_assets] fixture could not start: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    const deadline = Date.now() + options.pollSeconds * 1000;
    let lastStatus: ToolEnvelope | null = null;
    do {
      lastStatus = await callTool(client, "get_wizard_status", {
        draftId,
        includeJobs: true,
        includeWarnings: true,
      });
      const statusData = objectValue(lastStatus.data);
      const jobs = arrayValue(statusData.jobs);
      console.info(
        `[get_wizard_status] ready=${String(statusData.readyForReview)} jobs=${jobs
          .map((job) => String(job.status))
          .join(",")}`,
      );
      const pending = jobs.some((job) =>
        ["PENDING", "RUNNING", "RETRY_SCHEDULED"].includes(String(job.status)),
      );
      if (!pending || Date.now() >= deadline) break;
      await sleep(2000);
    } while (Date.now() < deadline);

    const reviewed = await callTool(client, "review_wizard", {
      draftId,
      includePreview: true,
      includePublishPlan: true,
    });
    const review = objectValue(reviewed.data);
    console.info(
      `[review_wizard] draft=${draftId} ready=${String(review.readyToPublish)}`,
    );

    if (!options.publish) {
      console.info("[done] non-publish smoke complete");
      return;
    }
    if (review.readyToPublish !== true || typeof review.revisionToken !== "string") {
      throw new Error("Review is not ready; refusing publish smoke");
    }
    console.info("[publish gate] review checklist passed; submitting approved smoke");
    const published = await callTool(client, "publish_listing", {
      draftId,
      revisionToken: review.revisionToken,
      idempotencyKey: `smoke-publish-${randomUUID()}`,
      note: "Explicit MCP publish smoke",
    });
    const submissions = arrayValue(published.data?.submissions);
    console.info(
      `[publish_listing] attempts=${submissions
        .map((item) => String(item.publishAttemptId))
        .join(",")}`,
    );

    const publishDeadline = Date.now() + options.pollSeconds * 1000;
    do {
      const status = await callTool(client, "get_publish_status", {
        draftId,
        includeJobs: true,
      });
      const statusData = objectValue(status.data);
      console.info(`[get_publish_status] ${String(statusData.overallStatus)}`);
      if (
        ["ACTIVE", "PARTIAL_FAILURE", "FAILED"].includes(
          String(statusData.overallStatus),
        ) ||
        Date.now() >= publishDeadline
      ) {
        break;
      }
      await sleep(2000);
    } while (Date.now() < publishDeadline);
  } finally {
    await client.close().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
