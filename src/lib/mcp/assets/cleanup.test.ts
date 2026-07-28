import assert from "node:assert/strict";
import test from "node:test";

import { purgeStorageThenRecord, shouldDeleteTemporaryAsset } from "./cleanup";

const now = new Date("2026-07-24T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

test("unattached transfer expires after 24 hours", () => {
  assert.deepEqual(
    shouldDeleteTemporaryAsset(
      {
        attached: false,
        expiresAt: daysAgo(1),
        draftStatus: null,
        draftUpdatedAt: null,
        mockupJobStatuses: [],
        listingStatuses: [],
        publishStatuses: [],
        terminalAt: null,
      },
      now,
    ),
    { delete: true, reason: "unattached_expired" },
  );
});

test("inactive draft asset expires after 30 days", () => {
  assert.deepEqual(
    shouldDeleteTemporaryAsset(
      {
        attached: true,
        expiresAt: daysAgo(1),
        draftStatus: "DRAFT",
        draftUpdatedAt: daysAgo(31),
        mockupJobStatuses: ["completed"],
        listingStatuses: [],
        publishStatuses: [],
        terminalAt: null,
      },
      now,
    ),
    { delete: true, reason: "draft_inactive_30d" },
  );
});

test("terminal publish asset expires after seven days", () => {
  assert.deepEqual(
    shouldDeleteTemporaryAsset(
      {
        attached: true,
        expiresAt: daysAgo(20),
        draftStatus: "PUBLISHED",
        draftUpdatedAt: daysAgo(20),
        mockupJobStatuses: ["completed"],
        listingStatuses: ["ACTIVE"],
        publishStatuses: ["COMPLETED"],
        terminalAt: daysAgo(8),
      },
      now,
    ),
    { delete: true, reason: "terminal_publish_7d" },
  );
});

test("active generation, listing, or retry state always wins over age", () => {
  const base = {
    attached: true,
    expiresAt: daysAgo(90),
    draftStatus: "ABANDONED",
    draftUpdatedAt: daysAgo(90),
    mockupJobStatuses: ["completed"],
    listingStatuses: ["FAILED"],
    publishStatuses: ["FAILED"],
    terminalAt: daysAgo(90),
  };
  for (const candidate of [
    { ...base, draftStatus: "GENERATING" },
    { ...base, mockupJobStatuses: ["running"] },
    { ...base, listingStatuses: ["PUBLISHING"] },
    { ...base, publishStatuses: ["RETRY_SCHEDULED"] },
    { ...base, publishStatuses: ["PENDING"] },
    { ...base, publishStatuses: ["RUNNING"] },
  ]) {
    assert.deepEqual(shouldDeleteTemporaryAsset(candidate, now), {
      delete: false,
      reason: "active_work",
    });
  }
});

test("storage deletion failure retains the database row for retry", async () => {
  let dbDeleted = false;
  const result = await purgeStorageThenRecord({
    paths: ["temporary/a.png", "temporary/a.webp"],
    deleteStorage: async (path) => {
      if (path.endsWith(".webp")) throw new Error("disk busy");
    },
    deleteRecord: async () => {
      dbDeleted = true;
    },
  });
  assert.equal(result.deleted, false);
  assert.equal(dbDeleted, false);
  assert.match(result.error ?? "", /disk busy/);
});
