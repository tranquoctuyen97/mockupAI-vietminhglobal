import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./queue.ts", import.meta.url), "utf8");

describe("publish queue contract", () => {
  it("uses publishAttemptId in payload and job id", () => {
    assert.match(source, /publishAttemptId: string/);
    assert.match(source, /jobId:\s*`publish-\$\{input\.listingId\}-\$\{input\.publishAttemptId\}`/);
    assert.doesNotMatch(source, /jobId:\s*`publish-\$\{input\.listingId\}`/);
  });

  it("uses BullMQ retry ownership", () => {
    assert.match(source, /attempts:\s*5/);
    assert.match(source, /type:\s*"exponential"/);
    assert.match(source, /delay:\s*60_000/);
    assert.match(source, /removeOnComplete:\s*\{/);
    assert.match(source, /age:\s*24\s*\*\s*60\s*\*\s*60/);
    assert.match(source, /removeOnFail:\s*\{/);
  });
});
