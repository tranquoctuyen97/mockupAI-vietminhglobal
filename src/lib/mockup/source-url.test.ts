import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomMockupSourceUrl,
  parseMockupSourceUrl,
} from "./source-url.js";

// --- New scope-aware URL format ---

test("parseMockupSourceUrl identifies template final sources", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://custom/template/final/abc123"), {
    kind: "custom",
    scope: "template",
    renderMode: "FINAL",
    sourceId: "abc123",
  });
});

test("parseMockupSourceUrl identifies template composite sources", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://custom/template/composite/xyz789"), {
    kind: "custom",
    scope: "template",
    renderMode: "COMPOSITE",
    sourceId: "xyz789",
  });
});

test("parseMockupSourceUrl identifies draft final sources", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://custom/draft/final/draft001"), {
    kind: "custom",
    scope: "draft",
    renderMode: "FINAL",
    sourceId: "draft001",
  });
});

test("parseMockupSourceUrl identifies draft composite sources", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://custom/draft/composite/draft002"), {
    kind: "custom",
    scope: "draft",
    renderMode: "COMPOSITE",
    sourceId: "draft002",
  });
});

// --- Legacy URL compatibility ---

test("parseMockupSourceUrl maps legacy custom-final to template scope", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://custom-final/abc123"), {
    kind: "custom",
    scope: "template",
    renderMode: "FINAL",
    sourceId: "abc123",
  });
});

test("parseMockupSourceUrl maps legacy custom-composite to template scope", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://custom-composite/xyz789"), {
    kind: "custom",
    scope: "template",
    renderMode: "COMPOSITE",
    sourceId: "xyz789",
  });
});

// --- Synthetic and Printify ---

test("parseMockupSourceUrl preserves synthetic mockup sources", () => {
  assert.deepEqual(parseMockupSourceUrl("mockup://solid/front"), {
    kind: "synthetic",
    view: "front",
  });
});

test("parseMockupSourceUrl falls back to printify for remote or empty values", () => {
  assert.deepEqual(parseMockupSourceUrl("https://images.printify.com/mockup.png"), {
    kind: "printify",
  });
  assert.deepEqual(parseMockupSourceUrl(""), { kind: "printify" });
});

// --- Builder ---

test("buildCustomMockupSourceUrl encodes template scope", () => {
  assert.equal(
    buildCustomMockupSourceUrl("id1", "TEMPLATE", "FINAL"),
    "mockup://custom/template/final/id1",
  );
  assert.equal(
    buildCustomMockupSourceUrl("id1", "TEMPLATE", "COMPOSITE"),
    "mockup://custom/template/composite/id1",
  );
});

test("buildCustomMockupSourceUrl encodes draft scope", () => {
  assert.equal(
    buildCustomMockupSourceUrl("id2", "DRAFT", "FINAL"),
    "mockup://custom/draft/final/id2",
  );
  assert.equal(
    buildCustomMockupSourceUrl("id2", "DRAFT", "COMPOSITE"),
    "mockup://custom/draft/composite/id2",
  );
});

// --- Round-trip ---

test("buildCustomMockupSourceUrl output is parseable", () => {
  const url = buildCustomMockupSourceUrl("roundtrip-1", "DRAFT", "COMPOSITE");
  const parsed = parseMockupSourceUrl(url);
  assert.deepEqual(parsed, {
    kind: "custom",
    scope: "draft",
    renderMode: "COMPOSITE",
    sourceId: "roundtrip-1",
  });
});
