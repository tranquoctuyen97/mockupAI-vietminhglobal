import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../../prisma/schema.prisma", import.meta.url), "utf8");
const callback = readFileSync(new URL("../shopify/callback/route.ts", import.meta.url), "utf8");
const newStore = readFileSync(
  new URL("../../(authed)/stores/new/page.tsx", import.meta.url),
  "utf8",
);
const guide = readFileSync(
  new URL("../../(authed)/docs/custom-app/page.tsx", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../../(authed)/stores/[id]/config/page.tsx", import.meta.url),
  "utf8",
);

describe("Shopify report access surfaces", () => {
  it("persists granted scopes and currency", () => {
    expect(schema).toContain("shopifyCurrencyCode");
    expect(schema).toContain("shopifyGrantedScopes");
    expect(callback).toContain("normalizeGrantedScopes(scope)");
    expect(callback).toContain("shopifyCurrencyCode: shopInfo.currencyCode");
  });

  it("documents read_reports and exposes reconnect state", () => {
    expect(newStore).toContain('scope: "read_reports"');
    expect(guide).toContain("read_reports");
    expect(config).toContain("Reports access");
    expect(config).toContain("Reconnect required");
  });
});
