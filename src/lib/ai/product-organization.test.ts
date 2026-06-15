import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORGANIZATION_JSON_SCHEMA,
  buildOrganizationUserPrompt,
  parseProductOrganizationJson,
} from "./providers/shared";

describe("product organization AI helpers", () => {
  it("builds a prompt that requests strict JSON and broad manual collections", () => {
    const prompt = buildOrganizationUserPrompt({
      title: "Patriotic Eagle Shirt",
      descriptionHtml: "<p>Soft cotton tee</p>",
      productType: "Unisex Heavy Cotton Tee",
      canonicalProductType: "T-Shirt",
      currentTags: ["shirt"],
      currentCollections: ["T-Shirts"],
      selectedColors: ["Black", "Navy"],
      designContext: "Eagle flag artwork",
      niche: "Patriotic",
    });

    assert.match(prompt, /Return strict JSON/);
    assert.match(prompt, /manual collection suggestions/i);
    assert.match(prompt, /T-Shirts/);
    assert.match(prompt, /Patriotic/);
  });

  it("parses and normalizes organization JSON", () => {
    assert.deepEqual(
      parseProductOrganizationJson(
        JSON.stringify({
          tags: [" Patriotic ", "patriotic", "", "T-Shirt"],
          collections: [" T-Shirts ", "t-shirts", "Patriotic", "", "New Arrivals"],
        }),
        { tokensIn: 11, tokensOut: 22 },
      ),
      {
        tags: ["Patriotic", "T-Shirt"],
        collections: ["T-Shirts", "Patriotic", "New Arrivals"],
        tokensIn: 11,
        tokensOut: 22,
      },
    );
  });

  it("defines a strict schema with tags and collections", () => {
    assert.equal(ORGANIZATION_JSON_SCHEMA.additionalProperties, false);
    assert.deepEqual(ORGANIZATION_JSON_SCHEMA.required, ["tags", "collections"]);
  });
});
