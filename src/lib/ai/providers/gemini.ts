import { GoogleGenAI, Type } from "@google/genai";
import { ContentGenerator, ContentInput, ContentOutput } from "../types";
import { SYSTEM_PROMPT_POD_LISTING } from "../prompts/pod-listing";

export class GeminiProvider implements ContentGenerator {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string = "gemini-2.5-flash") {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async generate(input: ContentInput): Promise<ContentOutput> {
    const prompt = `Please generate content for the following product:
Design Name: ${input.designName}
Product Type: ${input.productType}
Placement: ${input.placement}
Colors: ${input.colors.join(", ")}
`;

    // Note: Gemini SDK structured output
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT_POD_LISTING,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "Product title, max 60 chars",
            },
            description: {
              type: Type.STRING,
              description: "HTML description, 150-200 words",
            },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Exactly 15 relevant SEO tags, lowercase, distinct",
            },
            altText: {
              type: Type.STRING,
              description: "Image alt text, max 125 chars",
            },
          },
          required: ["title", "description", "tags", "altText"],
        },
      },
    });

    const tokensIn = response.usageMetadata?.promptTokenCount || 0;
    const tokensOut = response.usageMetadata?.candidatesTokenCount || 0;

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response from AI");
    }

    try {
      const parsed = JSON.parse(resultText);
      // Defense-in-depth: server-side truncate to MAX 15 (Shopify allowed)
      const tags: string[] = Array.isArray(parsed.tags)
        ? parsed.tags.slice(0, 15)
        : [];
      return {
        title: parsed.title,
        description: parsed.description,
        tags,
        altText: parsed.altText,
        tokensIn,
        tokensOut,
      };
    } catch (error) {
      console.error("Failed to parse Gemini output:", resultText);
      throw new Error("AI returned malformed JSON");
    }
  }
}
