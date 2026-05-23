import assert from "node:assert/strict";
import test from "node:test";
import { parseMockupSourceUrl } from "../../lib/mockup/source-url.js";
import { getSourceBadge, scopeSortPriority } from "./MockupGallery.js";

// --- Badge tests ---

test("getSourceBadge: draft custom final uses user-facing listing badge", () => {
  const parsed = parseMockupSourceUrl("mockup://custom/draft/final/id1");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Mockup riêng");
});

test("getSourceBadge: draft custom composite uses user-facing listing badge", () => {
  const parsed = parseMockupSourceUrl("mockup://custom/draft/composite/id2");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Mockup riêng");
});

test("getSourceBadge: template custom final uses library badge", () => {
  const parsed = parseMockupSourceUrl("mockup://custom/template/final/id3");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Từ thư viện");
});

test("getSourceBadge: template custom composite uses library badge", () => {
  const parsed = parseMockupSourceUrl("mockup://custom/template/composite/id4");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Từ thư viện");
});

test("getSourceBadge: Printify badge", () => {
  const parsed = parseMockupSourceUrl("https://images.printify.com/mockup.png");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Printify");
});

test("getSourceBadge: synthetic returns null", () => {
  const parsed = parseMockupSourceUrl("mockup://solid/front");
  const badge = getSourceBadge(parsed);
  assert.equal(badge, null);
});

// --- Sort priority tests ---

test("scopeSortPriority: draft custom sorts before template custom", () => {
  const draft = scopeSortPriority(parseMockupSourceUrl("mockup://custom/draft/final/id1"));
  const template = scopeSortPriority(parseMockupSourceUrl("mockup://custom/template/final/id2"));
  assert.ok(draft < template);
});

test("scopeSortPriority: template custom sorts before printify", () => {
  const template = scopeSortPriority(parseMockupSourceUrl("mockup://custom/template/final/id1"));
  const printify = scopeSortPriority(parseMockupSourceUrl("https://images.printify.com/mockup.png"));
  assert.ok(template < printify);
});

test("scopeSortPriority: printify sorts before synthetic", () => {
  const printify = scopeSortPriority(parseMockupSourceUrl("https://images.printify.com/mockup.png"));
  const synthetic = scopeSortPriority(parseMockupSourceUrl("mockup://solid/front"));
  assert.ok(printify < synthetic);
});

test("scopeSortPriority: full order is draft < template < printify < synthetic", () => {
  const draft = scopeSortPriority(parseMockupSourceUrl("mockup://custom/draft/final/id1"));
  const template = scopeSortPriority(parseMockupSourceUrl("mockup://custom/template/composite/id2"));
  const printify = scopeSortPriority(parseMockupSourceUrl("https://images.printify.com/mockup.png"));
  const synthetic = scopeSortPriority(parseMockupSourceUrl("mockup://solid/front"));

  assert.deepEqual([draft, template, printify, synthetic], [0, 1, 2, 3]);
});

// --- Legacy badge compatibility ---

test("getSourceBadge: legacy custom-final maps to library badge", () => {
  const parsed = parseMockupSourceUrl("mockup://custom-final/legacy1");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Từ thư viện");
});

test("getSourceBadge: legacy custom-composite maps to library badge", () => {
  const parsed = parseMockupSourceUrl("mockup://custom-composite/legacy2");
  const badge = getSourceBadge(parsed);
  assert.ok(badge);
  assert.equal(badge.label, "Từ thư viện");
});
