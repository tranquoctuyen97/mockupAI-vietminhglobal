import assert from "node:assert/strict";
import test from "node:test";

import { MCP_TOOL_CATALOG } from "./catalog";

const expected = [
  "list_stores",
  "search_designs",
  "search_mockups",
  "get_store_wizard_config",
  "get_listing_wizard",
  "create_listing_wizard",
  "attach_wizard_design_url",
  "set_wizard_designs",
  "set_wizard_custom_mockups",
  "set_wizard_product_config",
  "set_wizard_content",
  "generate_wizard_assets",
  "get_wizard_status",
  "review_wizard",
  "publish_listing",
  "get_publish_status",
];

test("Phase 3 catalog registers each approved tool exactly once", () => {
  assert.deepEqual(
    MCP_TOOL_CATALOG.map((tool) => tool.name),
    expected,
  );
  assert.equal(new Set(expected).size, MCP_TOOL_CATALOG.length);
});

test("every tool exposes client-readable metadata and safe annotations", () => {
  for (const tool of MCP_TOOL_CATALOG) {
    assert.ok(tool.title.length > 3, tool.name);
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal(
      tool.annotations.destructiveHint,
      tool.name === "publish_listing",
      tool.name,
    );
    assert.equal(tool.annotations.idempotentHint, true, tool.name);
    assert.ok(tool.inputSchema.description, `${tool.name} input description`);
    assert.ok(tool.outputSchema.description, `${tool.name} output description`);
  }
});

test("read tools are discovery rate limited and mutation tools require idempotency", () => {
  for (const tool of MCP_TOOL_CATALOG) {
    if (tool.annotations.readOnlyHint) {
      assert.equal(tool.rateClass, "discovery", tool.name);
    } else {
      assert.ok(
        "idempotencyKey" in tool.inputSchema.shape,
        `${tool.name} idempotencyKey`,
      );
    }
  }
});

test("catalog permission groups match the approved feature boundaries", () => {
  assert.equal(
    MCP_TOOL_CATALOG.find((tool) => tool.name === "list_stores")
      ?.requiredToolGroup,
    "store_discovery",
  );
  assert.equal(
    MCP_TOOL_CATALOG.find((tool) => tool.name === "search_designs")
      ?.requiredToolGroup,
    "design_library",
  );
  assert.equal(
    MCP_TOOL_CATALOG.find((tool) => tool.name === "search_mockups")
      ?.requiredToolGroup,
    "mockup_library",
  );
  for (const tool of MCP_TOOL_CATALOG.slice(3)) {
    assert.equal(
      tool.requiredToolGroup,
      ["publish_listing", "get_publish_status"].includes(tool.name)
        ? "publish"
        : "wizard",
      tool.name,
    );
  }
});
