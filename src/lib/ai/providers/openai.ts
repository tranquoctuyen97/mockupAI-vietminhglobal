import type { ContentGenerator, ContentInput, ContentOutput } from "../types";
import {
  buildListingUserPrompt,
  parseListingContentJson,
  POD_LISTING_JSON_SCHEMA,
} from "./shared";

export class OpenAiProvider implements ContentGenerator {
  constructor(
    private apiKey: string,
    private modelName: string = "gpt-5-mini",
    private systemPrompt: string = "",
  ) {}

  async generate(input: ContentInput): Promise<ContentOutput> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: this.systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: buildListingUserPrompt(input) }],
          },
        ],
        max_output_tokens: 1600,
        text: {
          format: {
            type: "json_schema",
            name: "pod_listing_content",
            strict: true,
            schema: POD_LISTING_JSON_SCHEMA,
          },
        },
      }),
    });

    const data = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new OpenAiRequestError(
        response.status,
        data?.error?.message || `OpenAI request failed (${response.status})`,
        data?.error?.code,
        data?.error?.type,
      );
    }

    const resultText = data?.output_text ?? extractOpenAiOutputText(data);
    if (!resultText) throw new Error("OpenAI returned empty response");

    return parseListingContentJson(resultText, {
      tokensIn: data?.usage?.input_tokens ?? 0,
      tokensOut: data?.usage?.output_tokens ?? 0,
    });
  }
}

export class OpenAiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public type?: string,
  ) {
    super(`OpenAI request failed (${status}): ${message}`);
    this.name = "OpenAiRequestError";
  }
}

function extractOpenAiOutputText(data: any): string {
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  return "";
}
