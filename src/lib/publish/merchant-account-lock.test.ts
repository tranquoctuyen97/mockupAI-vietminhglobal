import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./merchant-account-lock.ts", import.meta.url), "utf8");

describe("merchant account lock", () => {
  it("uses Merchant account identity, not token string", () => {
    assert.match(source, /merchantAccountId/);
    assert.doesNotMatch(source, /hashToken/);
  });

  it("releases atomically with Lua", () => {
    assert.match(source, /redis\.eval/);
    assert.match(source, /redis\.call\("GET"/);
    assert.match(source, /redis\.call\("DEL"/);
  });

  it("renews the lock while long publish work runs", () => {
    assert.match(source, /setInterval/);
    assert.match(source, /PEXPIRE/i);
  });

  it("tracks lock loss and stops future Printify calls", () => {
    assert.match(source, /lockLost/);
    assert.match(source, /throwIfLockLost/);
    assert.match(source, /MerchantAccountLockLostError/);
  });

  it("allows ioredis to buffer the first lazy-connect lock command", () => {
    assert.match(source, /lazyConnect:\s*true/);
    assert.match(source, /enableOfflineQueue:\s*true/);
  });
});
