import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeModel } from "./catalog";
import {
  filterOpenAiModelIds,
  mapClaudeModel,
  mapGeminiModel,
  mergeProviderModels,
} from "./model-discovery";

describe("AI model discovery", () => {
  it("filters OpenAI model ids to text-compatible GPT models", () => {
    assert.deepEqual(
      filterOpenAiModelIds([
        "gpt-5.4-mini",
        "gpt-5-mini",
        "text-embedding-3-small",
        "gpt-image-1",
        "dall-e-3",
        "whisper-1",
        "ft:gpt-4o-mini:tenant:suffix",
      ]),
      ["gpt-5.4-mini", "gpt-5-mini"],
    );
  });

  it("keeps only Gemini models that support generateContent", () => {
    assert.equal(
      mapGeminiModel({
        name: "models/gemini-3.0-flash",
        displayName: "Gemini 3.0 Flash",
        supportedActions: ["generateContent", "countTokens"],
      })?.id,
      "gemini-3.0-flash",
    );
    assert.equal(
      mapGeminiModel({
        name: "models/text-embedding-004",
        supportedActions: ["embedContent"],
      }),
      null,
    );
  });

  it("accepts Gemini REST supportedGenerationMethods field", () => {
    assert.equal(
      mapGeminiModel({
        name: "models/gemini-2.5-flash-preview-09-2025",
        displayName: "Gemini 2.5 Flash Preview",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      })?.id,
      "gemini-2.5-flash-preview-09-2025",
    );
  });

  it("maps Claude model metadata", () => {
    assert.deepEqual(
      mapClaudeModel({
        id: "claude-sonnet-4-20250514",
        display_name: "Claude Sonnet 4",
        created_at: "2025-02-19T00:00:00Z",
      }),
      {
        id: "claude-sonnet-4-20250514",
        label: "Claude Sonnet 4",
        source: "discovered",
        verified: true,
        createdAt: "2025-02-19T00:00:00Z",
      },
    );
  });

  it("keeps an unavailable saved model as unverified", () => {
    const models = mergeProviderModels("openai", [], "gpt-6-mini");
    assert.equal(models.at(-1)?.id, "gpt-6-mini");
    assert.equal(models.at(-1)?.source, "saved");
    assert.equal(models.at(-1)?.verified, false);
  });

  it("normalizes safe discovered models without falling back to default", () => {
    assert.equal(normalizeModel("openai", "gpt-5.4-mini"), "gpt-5.4-mini");
    assert.equal(normalizeModel("openai", "text-embedding-3-small"), "gpt-5-mini");
    assert.equal(normalizeModel("gemini", "models/gemini-3.0-pro"), "gemini-3.0-pro");
  });
});
