import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getMcpToolReference } from "./catalog-docs";
import { MCP_TOOL_CATALOG } from "./catalog";

test("runtime and approved Markdown contain the exact same 16 tool names", () => {
  const markdown = readFileSync(
    "docs/superpowers/specs/2026-07-24-admin-mcp-tools-catalog.md",
    "utf8",
  );
  const markdownHeadings = new Set(
    [...markdown.matchAll(/^### `([^`]+)`$/gm)].map((match) => match[1]),
  );
  const runtimeNames = MCP_TOOL_CATALOG.map((entry) => entry.name);
  assert.equal(runtimeNames.length, 16);
  assert.deepEqual(
    [...markdownHeadings].filter((name) => runtimeNames.includes(name)).sort(),
    [...runtimeNames].sort(),
  );
});

test("every UI reference is generated from complete safe runtime metadata", () => {
  const docs = getMcpToolReference();
  assert.equal(docs.length, 16);
  for (const entry of docs) {
    assert.ok(entry.description);
    assert.ok(entry.title);
    assert.ok(entry.output.description);
    assert.ok(entry.output.fields.length >= 4);
    assert.ok(entry.commonErrors.length > 0);
    assert.ok(entry.requestExample.tool === entry.name);
    assert.doesNotMatch(JSON.stringify(entry), /tokenHash|accessTokenHash|refreshTokenHash/);
    for (const parameter of [...entry.requiredParams, ...entry.optionalParams]) {
      assert.ok(parameter.description, `${entry.name}.${parameter.name} needs docs`);
    }
  }
});

test("publish_listing is the only destructive runtime tool", () => {
  const destructive = getMcpToolReference()
    .filter((entry) => entry.annotations.destructiveHint)
    .map((entry) => entry.name);
  assert.deepEqual(destructive, ["publish_listing"]);
});
