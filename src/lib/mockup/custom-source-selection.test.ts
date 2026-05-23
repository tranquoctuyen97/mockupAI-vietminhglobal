import assert from "node:assert/strict";
import test from "node:test";
import { resolveCustomMockupSourceSelection } from "./custom-source-selection.js";

test("resolveCustomMockupSourceSelection selects all sources by default and keeps asset primary", () => {
  const result = resolveCustomMockupSourceSelection({
    sources: [
      { id: "draft-a", colorId: "black", isPrimary: false, sortOrder: 0 },
      { id: "template-a", colorId: "black", isPrimary: true, sortOrder: 1 },
      { id: "template-b", colorId: "navy", isPrimary: false, sortOrder: 2 },
    ],
  });

  assert.deepEqual(result.selectedSourceIds, ["draft-a", "template-a", "template-b"]);
  assert.equal(result.primarySourceId, "template-a");
  assert.deepEqual(
    result.selectedSources.map((source) => `${source.id}:${source.isPrimary}`),
    ["draft-a:false", "template-a:true", "template-b:false"],
  );
});

test("resolveCustomMockupSourceSelection respects explicit picks and primary override", () => {
  const result = resolveCustomMockupSourceSelection({
    sources: [
      { id: "draft-a", colorId: "black", isPrimary: false, sortOrder: 0 },
      { id: "template-a", colorId: "black", isPrimary: true, sortOrder: 1 },
      { id: "template-b", colorId: "navy", isPrimary: false, sortOrder: 2 },
    ],
    picks: [
      { sourceId: "template-b", isPrimary: false },
      { sourceId: "draft-a", isPrimary: true },
    ],
  });

  assert.deepEqual(result.selectedSourceIds, ["draft-a", "template-b"]);
  assert.equal(result.primarySourceId, "draft-a");
  assert.deepEqual(
    result.selectedSources.map((source) => `${source.id}:${source.isPrimary}`),
    ["draft-a:true", "template-b:false"],
  );
});

test("resolveCustomMockupSourceSelection falls back to first selected source when no primary is provided", () => {
  const result = resolveCustomMockupSourceSelection({
    sources: [
      { id: "draft-a", colorId: "black", isPrimary: false, sortOrder: 0 },
      { id: "template-a", colorId: "black", isPrimary: false, sortOrder: 1 },
    ],
    picks: [
      { sourceId: "template-a", isPrimary: false },
      { sourceId: "draft-a", isPrimary: false },
    ],
  });

  assert.deepEqual(result.selectedSourceIds, ["draft-a", "template-a"]);
  assert.equal(result.primarySourceId, "draft-a");
});
