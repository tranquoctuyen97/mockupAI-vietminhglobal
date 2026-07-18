import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  endpointCategory,
  PrintifyCooldownActiveError,
  PrintifyRequestGate,
  printifyCooldownKey,
} from "./request-gate";

const source = readFileSync(new URL("./request-gate.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
const accountSource = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

describe("Printify request gate", () => {
  it("uses documented cooldown buckets", () => {
    assert.equal(printifyCooldownKey("acct-1", "general"), "printify:cooldown:acct-1:general");
    assert.equal(endpointCategory("/uploads/images.json"), "upload");
    assert.equal(endpointCategory("/catalog/blueprints.json"), "catalog");
    assert.equal(endpointCategory("/shops/123/products/abc/publish.json"), "product-publish");
    assert.doesNotMatch(source, /:upload/);
  });

  it("sets general cooldown for every rate limit and endpoint cooldown only for documented buckets", () => {
    assert.match(source, /printifyCooldownKey\(this\.merchantAccountId,\s*"general"\)/);
    assert.match(source, /category === "catalog" \|\| category === "product-publish"/);
    assert.match(source, /retryDelayWithJitter/);
  });

  it("checks cooldown before every hooked Printify request", () => {
    assert.match(clientSource, /beforeRequest/);
    assert.match(clientSource, /await this\.hooks\.beforeRequest/);
    assert.match(source, /throw new PrintifyCooldownActiveError/);
    assert.match(
      accountSource,
      /new PrintifyRequestGate\(\{ merchantAccountId: store\.printifyShop\.account\.id \}\)/,
    );
    assert.match(accountSource, /new PrintifyClient\(apiKey,\s*\{/);
  });

  it("does not mask the original PrintifyRateLimitError when cooldown persistence fails", () => {
    assert.match(clientSource, /const rateLimitError = new PrintifyRateLimitError/);
    assert.match(clientSource, /Failed to persist Printify cooldown metadata/);
    assert.match(clientSource, /throw rateLimitError/);
  });

  it("continues the Printify request when Redis cooldown check is not writable", async () => {
    const gate = new PrintifyRequestGate({
      merchantAccountId: "acct-1",
      redis: {
        pttl: async () => {
          throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
        },
        set: async () => "OK",
        disconnect: () => undefined,
      },
    });

    await assert.doesNotReject(() =>
      gate.beforeRequest({ endpoint: "/catalog/blueprints.json", method: "GET" }),
    );
  });

  it("allows ioredis to buffer the first lazy-connect command", () => {
    assert.match(source, /lazyConnect:\s*true/);
    assert.match(source, /enableOfflineQueue:\s*true/);
  });

  it("still blocks the Printify request when a real cooldown is active", async () => {
    const gate = new PrintifyRequestGate({
      merchantAccountId: "acct-1",
      redis: {
        pttl: async () => 10_000,
        set: async () => "OK",
        disconnect: () => undefined,
      },
    });

    await assert.rejects(
      () => gate.beforeRequest({ endpoint: "/catalog/blueprints.json", method: "GET" }),
      PrintifyCooldownActiveError,
    );
  });
});
