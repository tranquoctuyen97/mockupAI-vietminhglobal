import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCacheKey } from "./cache";
import type { ContentInput } from "./types";

const input: ContentInput = {
  designName: "Milestone Design",
  productType: "Unisex Tee",
  colors: ["Gold", "Royal Blue"],
  placement: "Front",
};

describe("AI cache key", () => {
  it("changes when the effective system prompt changes", () => {
    const keyA = generateCacheKey(input, "gemini", "gemini-2.5-flash", "prompt A");
    const keyB = generateCacheKey(input, "gemini", "gemini-2.5-flash", "prompt B");

    assert.notEqual(keyA, keyB);
  });

  it("keeps color ordering deterministic", () => {
    const shuffled: ContentInput = {
      ...input,
      colors: ["Royal Blue", "Gold"],
    };

    assert.equal(
      generateCacheKey(input, "openai", "gpt-5-mini", "same prompt"),
      generateCacheKey(shuffled, "openai", "gpt-5-mini", "same prompt"),
    );
  });
});
