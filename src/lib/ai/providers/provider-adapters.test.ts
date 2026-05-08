import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AnthropicProvider } from "./anthropic";
import { OpenAiProvider } from "./openai";
import type { ContentInput } from "../types";

const originalFetch = globalThis.fetch;

const input: ContentInput = {
  designName: "First Sale Badge",
  productType: "Sweatshirt",
  colors: ["Gold"],
  placement: "Front",
};

const contentJson = JSON.stringify({
  title: "First Sale Badge Sweatshirt",
  description: "<p>Celebrate your first sale milestone.</p>",
  tags: ["seller gift", "pod shirt"],
  altText: "Gold sweatshirt with first sale badge design",
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AI provider adapters", () => {
  it("OpenAI adapter sends custom system prompt and maps usage tokens", async () => {
    let requestBody: any = null;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output_text: contentJson,
          usage: {
            input_tokens: 12,
            output_tokens: 34,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = new OpenAiProvider("test-key", "gpt-5-mini", "custom system prompt");
    const result = await provider.generate(input);

    assert.equal(requestBody.model, "gpt-5-mini");
    assert.equal(requestBody.input[0].role, "system");
    assert.equal(requestBody.input[0].content[0].text, "custom system prompt");
    assert.equal(result.title, "First Sale Badge Sweatshirt");
    assert.equal(result.tokensIn, 12);
    assert.equal(result.tokensOut, 34);
  });

  it("Claude adapter sends custom system prompt and maps usage tokens", async () => {
    let requestBody: any = null;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: contentJson }],
          usage: {
            input_tokens: 21,
            output_tokens: 43,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = new AnthropicProvider("test-key", "claude-sonnet-4-20250514", "custom system prompt");
    const result = await provider.generate(input);

    assert.equal(requestBody.model, "claude-sonnet-4-20250514");
    assert.equal(requestBody.system, "custom system prompt");
    assert.equal(result.altText, "Gold sweatshirt with first sale badge design");
    assert.equal(result.tokensIn, 21);
    assert.equal(result.tokensOut, 43);
  });
});
