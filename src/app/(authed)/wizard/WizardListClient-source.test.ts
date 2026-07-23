import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/(authed)/wizard/WizardListClient.tsx", "utf8");

test("wizard list derives publish status from current listing state", () => {
  const allActiveIndex = source.indexOf('const allActive = listings.every((listing) => listing.status === "ACTIVE")');
  const hasFailedIndex = source.indexOf("const hasFailed =", allActiveIndex);

  assert.ok(allActiveIndex > -1, "allActive should be computed");
  assert.ok(hasFailedIndex > allActiveIndex, "ACTIVE listings should win before failed history");
  assert.match(source, /if \(listing\.status === "ACTIVE"\) return \[\]/);
});

test("wizard list filters publish jobs to active or latest attempt", () => {
  assert.match(source, /activePublishAttemptId/);
  assert.match(source, /publishAttemptId === listing\.activePublishAttemptId/);
  assert.match(source, /latestAttemptId/);
  assert.match(source, /publishAttemptId === latestAttemptId/);
});
