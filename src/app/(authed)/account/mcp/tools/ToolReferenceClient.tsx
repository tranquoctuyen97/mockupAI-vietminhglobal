"use client";

import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { McpToolReferenceEntry } from "@/lib/mcp/tools/catalog-docs";

const GROUPS = [
  "Discovery",
  "Design",
  "Wizard Mutation",
  "Review/Publish",
] as const;

export default function ToolReferenceClient({
  tools,
}: {
  tools: McpToolReferenceEntry[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tools;
    return tools.filter(
      (tool) =>
        tool.name.includes(normalized) ||
        tool.title.toLowerCase().includes(normalized) ||
        tool.description.toLowerCase().includes(normalized),
    );
  }, [query, tools]);

  return (
    <div className="space-y-6">
      <section className="card card-lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="badge badge-success">16 RUNTIME TOOLS</span>
            <h2 className="text-card-heading mt-3">MCP Tool Reference</h2>
            <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
              Generated from the same catalog registered by the MCP server. It is
              available before activation so Claude, Codex, and n8n can inspect exact
              parameter contracts.
            </p>
          </div>
          <label className="relative min-w-64">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2"
              size={16}
              style={{ color: "var(--text-muted)" }}
            />
            <input
              className="input w-full pl-9"
              onChange={(event) => setQuery(event.target.value.toLowerCase())}
              placeholder="Search tools or parameters"
              value={query}
            />
          </label>
        </div>
      </section>

      {GROUPS.map((group) => {
        const groupTools = filtered.filter((tool) => tool.group === group);
        if (groupTools.length === 0) return null;
        return (
          <section className="space-y-3" key={group}>
            <div className="flex items-center gap-3">
              <h2 className="text-card-heading">{group}</h2>
              <span className="badge badge-info">{groupTools.length}</span>
            </div>
            {groupTools.map((tool) => (
              <details className="card overflow-hidden" key={tool.name}>
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-semibold">{tool.name}</code>
                      {tool.annotations.readOnlyHint && (
                        <span className="badge badge-info">READ ONLY</span>
                      )}
                      {tool.annotations.destructiveHint && (
                        <span className="badge badge-danger">DESTRUCTIVE</span>
                      )}
                      <span className="badge badge-success">
                        IDEMPOTENT
                      </span>
                    </div>
                    <p className="mt-2 font-semibold">{tool.title}</p>
                    <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
                      {tool.description}
                    </p>
                  </div>
                  <ChevronDown size={18} />
                </summary>
                <div className="grid gap-5 border-t p-5 lg:grid-cols-2" style={{ borderColor: "var(--border-default)" }}>
                  <div className="space-y-5">
                    <div>
                      <h3 className="font-semibold">Guardrails</h3>
                      <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
                        Features: {tool.requiredFeatures.join(" + ")} · Scope:{" "}
                        {tool.requiredToolGroup} · Rate class: {tool.rateClass}
                      </p>
                    </div>
                    <ParameterList label="Required parameters" parameters={tool.requiredParams} />
                    <ParameterList label="Optional parameters" parameters={tool.optionalParams} />
                    <div>
                      <h3 className="font-semibold">Structured output</h3>
                      <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
                        {tool.output.description}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {tool.output.fields.map((field) => (
                          <li className="text-sm" key={field.name}>
                            <code>{field.name}</code> — {field.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="space-y-5">
                    <JsonBlock label="Request example" value={tool.requestExample} />
                    <JsonBlock label="Response example" value={tool.responseExample} />
                    <div>
                      <h3 className="font-semibold">Common errors</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {tool.commonErrors.map((error) => (
                          <code className="badge badge-info" key={error}>{error}</code>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ParameterList({
  label,
  parameters,
}: {
  label: string;
  parameters: McpToolReferenceEntry["requiredParams"];
}) {
  return (
    <div>
      <h3 className="font-semibold">{label}</h3>
      {parameters.length === 0 ? (
        <p className="text-body mt-1" style={{ color: "var(--text-muted)" }}>
          None
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {parameters.map((parameter) => (
            <li className="rounded-lg border p-3 text-sm" key={parameter.name} style={{ borderColor: "var(--border-default)" }}>
              <code className="font-semibold">{parameter.name}</code>
              <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                {parameter.description}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <h3 className="font-semibold">{label}</h3>
      <pre className="mt-2 max-h-80 overflow-auto rounded-lg p-4 text-xs" style={{ background: "var(--bg-tertiary)" }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
