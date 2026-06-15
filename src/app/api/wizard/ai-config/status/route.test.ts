import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("wizard AI config status route source", () => {
  it("validates session and returns only availability", () => {
    assert.match(source, /validateSession/);
    assert.match(source, /available/);
    assert.doesNotMatch(source, /decrypt/);
    assert.doesNotMatch(source, /apiKeyEncrypted.*NextResponse\.json/);
  });

  it("checks active provider settings and environment fallback", () => {
    assert.match(source, /aiSettings\.findUnique/);
    assert.match(source, /aiProviderSettings\.findUnique/);
    assert.match(source, /getProviderEnvKey/);
  });
});
