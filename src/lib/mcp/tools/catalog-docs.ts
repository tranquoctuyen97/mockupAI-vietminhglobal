import { z } from "zod";
import { MCP_TOOL_CATALOG } from "./catalog";

type JsonSchema = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

export type McpToolParameterDoc = {
  name: string;
  description: string;
  schema: JsonSchema;
};

export type McpToolReferenceEntry = {
  name: string;
  title: string;
  description: string;
  group: "Discovery" | "Design" | "Wizard Mutation" | "Review/Publish";
  requiredToolGroup: string;
  requiredFeatures: string[];
  rateClass: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: true;
  };
  requiredParams: McpToolParameterDoc[];
  optionalParams: McpToolParameterDoc[];
  inputSchema: JsonSchema;
  output: {
    description: string;
    fields: McpToolParameterDoc[];
    schema: JsonSchema;
  };
  commonErrors: string[];
  requestExample: {
    tool: string;
    arguments: Record<string, unknown>;
  };
  responseExample: {
    ok: true;
    data: Record<string, string>;
    warnings: string[];
    nextActions: string[];
  };
};

const COMMON_ERRORS = [
  "PERMISSION_DENIED",
  "CREDENTIAL_SCOPE_DENIED",
  "PROFILE_DISABLED",
  "PROFILE_SUSPENDED",
  "CREDENTIAL_REVOKED",
  "RESOURCE_NOT_FOUND",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
];

const FEATURE_MAP = {
  store_discovery: ["mcp_access"],
  design_library: ["mcp_access", "designs"],
  mockup_library: ["mcp_access", "mockup_library"],
  wizard: ["mcp_access", "wizard"],
  publish: ["mcp_access", "wizard", "listings"],
} as const;

const DESIGN_TOOLS = new Set([
  "search_designs",
  "search_mockups",
  "attach_wizard_design_url",
  "set_wizard_designs",
  "set_wizard_custom_mockups",
]);
const REVIEW_TOOLS = new Set([
  "review_wizard",
  "publish_listing",
  "get_publish_status",
]);

function groupFor(name: string, readOnly: boolean): McpToolReferenceEntry["group"] {
  if (REVIEW_TOOLS.has(name)) return "Review/Publish";
  if (DESIGN_TOOLS.has(name)) return "Design";
  if (readOnly) return "Discovery";
  return "Wizard Mutation";
}

function parameterDocs(schema: JsonSchema): {
  required: McpToolParameterDoc[];
  optional: McpToolParameterDoc[];
} {
  const requiredNames = new Set(schema.required ?? []);
  const required: McpToolParameterDoc[] = [];
  const optional: McpToolParameterDoc[] = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const item = {
      name,
      description:
        field.description ?? "See the field JSON schema for accepted values.",
      schema: field,
    };
    (requiredNames.has(name) ? required : optional).push(item);
  }
  return { required, optional };
}

function exampleForSchema(schema: JsonSchema, depth = 0): unknown {
  if (depth > 4) return "<value>";
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const variant = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (variant) return exampleForSchema(variant, depth + 1);
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? []);
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([name]) => required.has(name))
        .map(([name, field]) => [name, exampleForSchema(field, depth + 1)]),
    );
  }
  if (schema.type === "array") {
    return schema.items ? [exampleForSchema(schema.items, depth + 1)] : [];
  }
  if (schema.type === "number" || schema.type === "integer") return 1;
  if (schema.type === "boolean") return true;
  if (schema.description?.toLowerCase().includes("url")) {
    return "https://images.example.com/artwork.png";
  }
  if (schema.description?.toLowerCase().includes("idempotency")) {
    return "request-unique-id";
  }
  return "<value>";
}

export function getMcpToolReference(): McpToolReferenceEntry[] {
  return MCP_TOOL_CATALOG.map((entry) => {
    const inputSchema = z.toJSONSchema(entry.inputSchema) as JsonSchema;
    const outputSchema = z.toJSONSchema(entry.outputSchema) as JsonSchema;
    const input = parameterDocs(inputSchema);
    const output = parameterDocs(outputSchema);
    const toolErrors = [...COMMON_ERRORS];
    if (entry.rateClass === "url_import") {
      toolErrors.push("ASSET_URL_FETCH_FAILED", "UNSUPPORTED_IMAGE");
    }
    if (entry.name === "publish_listing") {
      toolErrors.push("CHECKLIST_NOT_READY", "REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT");
    } else if (!entry.annotations.readOnlyHint) {
      toolErrors.push("IDEMPOTENCY_CONFLICT");
    }

    return {
      name: entry.name,
      title: entry.title,
      description: entry.description,
      group: groupFor(entry.name, entry.annotations.readOnlyHint),
      requiredToolGroup: entry.requiredToolGroup,
      requiredFeatures: [...FEATURE_MAP[entry.requiredToolGroup]],
      rateClass: entry.rateClass,
      annotations: entry.annotations,
      requiredParams: input.required,
      optionalParams: input.optional,
      inputSchema,
      output: {
        description:
          outputSchema.description ?? "Standard structured MCP tool response.",
        fields: [...output.required, ...output.optional],
        schema: outputSchema,
      },
      commonErrors: [...new Set(toolErrors)],
      requestExample: {
        tool: entry.name,
        arguments: exampleForSchema(inputSchema) as Record<string, unknown>,
      },
      responseExample: {
        ok: true,
        data: { result: "<tool-specific result>" },
        warnings: [],
        nextActions: ["<recommended next tool>"],
      },
    };
  });
}
