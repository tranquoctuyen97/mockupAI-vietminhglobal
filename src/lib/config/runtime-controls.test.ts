import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAppLocale,
  isInternalControlsDebugEnabled,
  isMockupFallbackForcedForDev,
  isPublishDryRun,
  parseBooleanEnv,
} from "./runtime-controls";

describe("runtime controls", () => {
  it("parses common boolean env values", () => {
    assert.equal(parseBooleanEnv("true"), true);
    assert.equal(parseBooleanEnv("1"), true);
    assert.equal(parseBooleanEnv("yes"), true);
    assert.equal(parseBooleanEnv("on"), true);
    assert.equal(parseBooleanEnv("false"), false);
    assert.equal(parseBooleanEnv(undefined), false);
  });

  it("uses env for publish dry-run", () => {
    assert.equal(isPublishDryRun({ PUBLISH_DRY_RUN: "true" }), true);
    assert.equal(isPublishDryRun({ PUBLISH_DRY_RUN: "false" }), false);
  });

  it("only allows mockup fallback outside production", () => {
    assert.equal(isMockupFallbackForcedForDev({ NODE_ENV: "development", MOCKUP_FALLBACK_FORCE: "true" }), true);
    assert.equal(isMockupFallbackForcedForDev({ NODE_ENV: "test", MOCKUP_FALLBACK_FORCE: "1" }), true);
    assert.equal(isMockupFallbackForcedForDev({ NODE_ENV: "production", MOCKUP_FALLBACK_FORCE: "true" }), false);
  });

  it("only exposes internal controls outside production", () => {
    assert.equal(isInternalControlsDebugEnabled({ NODE_ENV: "development", FEATURE_FLAG_DEBUG_UI: "true" }), true);
    assert.equal(isInternalControlsDebugEnabled({ NODE_ENV: "production", FEATURE_FLAG_DEBUG_UI: "true" }), false);
  });

  it("defaults locale to Vietnamese and accepts English", () => {
    assert.equal(getAppLocale({}), "vi");
    assert.equal(getAppLocale({ APP_LOCALE: "en" }), "en");
    assert.equal(getAppLocale({ APP_LOCALE: "fr", NEXT_PUBLIC_APP_LOCALE: "en" }), "vi");
    assert.equal(getAppLocale({ NEXT_PUBLIC_APP_LOCALE: "en" }), "en");
  });
});
