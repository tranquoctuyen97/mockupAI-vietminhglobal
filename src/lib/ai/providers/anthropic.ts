import type {
  ContentGenerator,
  ContentInput,
  ContentOutput,
  ProductOrganizationInput,
  ProductOrganizationOutput,
} from "../types";
import {
  buildListingUserPrompt,
  buildOrganizationUserPrompt,
  parseListingContentJson,
  parseProductOrganizationJson,
} from "./shared";

export class AnthropicProvider implements ContentGenerator {
  constructor(
    private apiKey: string,
    private modelName: string = "claude-sonnet-4-20250514",
    private systemPrompt: string = "",
  ) {}

  async generate(input: ContentInput): Promise<ContentOutput> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 1600,
        system: this.systemPrompt,
        messages: [
          {
            role: "user",
            content: buildListingUserPrompt(input),
          },
        ],
      }),
    });

    const data = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(data?.error?.message || `Anthropic request failed (${response.status})`);
    }

    const resultText = Array.isArray(data?.content)
      ? data.content.map((part: any) => part?.text ?? "").join("\n").trim()
      : "";
    if (!resultText) throw new Error("Claude returned empty response");

    return parseListingContentJson(resultText, {
      tokensIn: data?.usage?.input_tokens ?? 0,
      tokensOut: data?.usage?.output_tokens ?? 0,
    });
  }

  async optimizeProductOrganization(
    input: ProductOrganizationInput,
  ): Promise<ProductOrganizationOutput> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 900,
        system: this.systemPrompt,
        messages: [{ role: "user", content: buildOrganizationUserPrompt(input) }],
      }),
    });

    const data = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(data?.error?.message || `Anthropic request failed (${response.status})`);
    }

    const resultText = Array.isArray(data?.content)
      ? data.content.map((part: any) => part?.text ?? "").join("\n").trim()
      : "";
    if (!resultText) throw new Error("Claude returned empty response");

    return parseProductOrganizationJson(resultText, {
      tokensIn: data?.usage?.input_tokens ?? 0,
      tokensOut: data?.usage?.output_tokens ?? 0,
    });
  }
}
