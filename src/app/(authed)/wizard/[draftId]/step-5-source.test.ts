import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/(authed)/wizard/[draftId]/step-5/page.tsx", "utf8");
const phaseSource = readFileSync("src/lib/publish/phases.ts", "utf8");

test("step 5 formats mixed listing and content labels", () => {
  assert.match(source, /formatListingSummaryLabel/);
  assert.match(source, /formatContentChecklistLabel/);
  assert.doesNotMatch(source, /designPairs\.length ×/);
  assert.doesNotMatch(source, /pairingComplete/);
  assert.doesNotMatch(source, /Tất cả design đã ghép cặp sáng\/tối/);
});

test("step 5 resolves active independent content from draftDesign aiContent", () => {
  assert.match(source, /activeIndependentDesign/);
  assert.match(source, /activeIndependentDesign\?\.aiContent/);
  assert.doesNotMatch(source, /designPairs\[0\]/);
});

test("step 5 renders one publish progress entry per pair listing", () => {
  assert.match(source, /const pairEntries = designPairs\.map/);
  assert.match(source, /publishKey:\s*pair\.id/);
  assert.match(source, /listing\.designPairId \?\? listing\.draftDesignId \?\? listing\.designId/);
  assert.doesNotMatch(
    source,
    /selectedDraftDesigns\.map\(\(entry\) => \{\s*const pair = designPairs\.find/s,
  );
});

test("step 5 hydrates publish progress from persisted listing jobs after reload", () => {
  assert.match(source, /interface PersistedPublishListing/);
  assert.match(source, /publishStateFromPersistedListing/);
  assert.match(source, /selectPublishJobsForDisplay/);
  assert.match(source, /persistedPublishListings/);
  assert.match(source, /activePublishAttemptId/);
  assert.match(source, /publishAttemptId/);
  assert.match(
    source,
    /listing\.wizardDraftDesignPairId \?\? listing\.wizardDraftDesignId \?\? listing\.designId/,
  );
  assert.match(source, /hydratePublishStateFromListings/);
  assert.match(source, /hasPublishingListings/);
});

test("step 5 keeps polling failed listings while an active retry still exists", () => {
  assert.match(source, /function isTerminalPublishListingStatus/);
  assert.match(source, /listing\.status === "ACTIVE"/);
  assert.match(source, /getLatestSucceededAttemptJobs\(allJobs\) \?\? \[\]/);
  assert.match(
    source,
    /const hasRunningJob =[\s\S]*?const hasActiveRetry =[\s\S]*?Boolean\(listing\.activePublishAttemptId\)[\s\S]*?hasRunningJob;/,
  );
  assert.match(source, /if \(hasActiveRetry\)/);
  assert.match(source, /retrying:\s*true/);
  assert.match(source, /Hệ thống đang tự thử lại/);
  assert.match(
    source,
    /const isTerminalListing = isTerminalPublishListingStatus\(listing\.status\)/,
  );
  assert.match(source, /if \(!isTerminalListing && \(hasRunningJob/);
  assert.match(source, /const successLogs = logs\.filter/);
});

test("step 5 polls persisted publish state while workers run in another process", () => {
  assert.match(source, /pollPersistedPublishState/);
  assert.match(source, /fetch\(`\/api\/wizard\/drafts\/\$\{draftId\}`/);
  assert.match(source, /cache:\s*"no-store"/);
  assert.match(source, /setTimeout\(pollPersistedPublishState,\s*3000\)/);
  assert.doesNotMatch(source, /toast\.error\("Mất kết nối server"\)/);
});

test("step 5 renders retry-scheduled jobs as Vietnamese pending progress", () => {
  assert.match(source, /RETRY_SCHEDULED/);
  assert.match(source, /Đang thử lại/);
  assert.match(source, /nextRetryAt/);
  assert.match(source, /Đang publish lại/);
});

test("step 5 renders live publish phase progress from SSE", () => {
  assert.match(source, /getPublishPhaseLabel/);
  assert.match(source, /eventType === "publish\.progress"/);
  assert.match(source, /stage:\s*phase \|\| "SHOPIFY"/);
});

test("publish phase user-facing labels are Vietnamese", () => {
  const labelBlock = phaseSource.slice(
    phaseSource.indexOf("export const PUBLISH_PHASE_LABELS"),
    phaseSource.indexOf("export function getPublishPhaseLabel"),
  );
  assert.doesNotMatch(
    labelBlock,
    /\b(product|variants|options|media|gallery|category|collections|verify|sales channels)\b/i,
  );
});
