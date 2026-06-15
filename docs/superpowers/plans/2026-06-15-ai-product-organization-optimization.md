# AI Product Organization Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual-edit-only Step 4 action that optimizes tags and manual collection suggestions, saves them in draft AI content, snapshots them to listings, and prefers resolvable Shopify Manual Collections during publish.

**Architecture:** Keep AI content generation unchanged. Add a separate organization optimization API and provider method that returns suggestions without mutating drafts. Persist collections in `WizardDraft.aiContent.collections`, snapshot to `Listing.organizationCollections`, and normalize/resolve those names to Shopify Manual Collection IDs before falling back to `PRODUCT_TYPE_COLLECTION_MAP`.

**Tech Stack:** Next.js 16.2.4 App Router, React 19 client components, TypeScript, Prisma 7/Postgres scalar lists, Node `node:test`, Shopify Admin GraphQL `productSet`, existing AI provider adapters.

---

## File Structure

- Create `src/lib/wizard/product-organization.ts`
  - Pure helpers for `mergeOptimizedTags()` and `normalizeOrganizationCollections()`.

- Create `src/lib/wizard/product-organization.test.ts`
  - Unit coverage for tag merge and collection normalization.

- Modify `src/lib/ai/types.ts`
  - Add product organization input/output interfaces and optional optimizer interface.

- Modify `src/lib/ai/providers/shared.ts`
  - Add strict JSON schema, prompt builder, and parser for organization optimization.

- Modify `src/lib/ai/providers/gemini.ts`
  - Add `optimizeProductOrganization()` without changing `generate()`.

- Modify `src/lib/ai/providers/openai.ts`
  - Add `optimizeProductOrganization()` without changing `generate()`.

- Modify `src/lib/ai/providers/anthropic.ts`
  - Add `optimizeProductOrganization()` without changing `generate()`.

- Create `src/lib/ai/product-organization.test.ts`
  - Unit coverage for parsing and cleanup of AI organization output.

- Create `src/app/api/wizard/ai-config/status/route.ts`
  - Lightweight wizard-accessible endpoint returning whether tenant AI config is available.

- Create `src/app/api/wizard/ai-config/status/route.test.ts`
  - Source-level guards for tenant/session lookup and no credential leakage.

- Create `src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.ts`
  - Pure suggestion endpoint. It validates draft ownership, derives store/context from draft, calls optimizer, and returns `{ tags, collections }`.

- Create `src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts`
  - Source-level guards proving no draft mutation and no trusted client `storeId`.

- Modify `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`
  - Add `collections` form state, manual-edit-only optimize button, collection chips/input, success/error toasts, and explicit manual Save behavior.

- Create `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`
  - Source-level guards for optimize button gating and no optimize call from generate/regenerate.

- Modify `prisma/schema.prisma`
  - Add `organizationCollections` to `Listing`.

- Create `prisma/migrations/20260615000000_add_listing_organization_collections/migration.sql`
  - Add Postgres `TEXT[]` column with default empty array.

- Modify `src/app/api/wizard/drafts/[id]/publish/route.ts`
  - Copy normalized `aiContent.collections` to listing snapshot.

- Create `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`
  - Add source coverage proving publish snapshots `aiContent.collections`.

- Modify `src/lib/publish/worker.ts`
  - Include `organizationCollections` from listing relation and pass it to Shopify publish.

- Modify `src/lib/publish/shopify.ts`
  - Accept `organizationCollections`, normalize again, resolve Manual Collection IDs first, fallback to `PRODUCT_TYPE_COLLECTION_MAP`.

- Modify `src/lib/publish/shopify.test.ts`
  - Unit/source coverage for manual collection priority, Smart Collection filtering, `ruleSet { appliedDisjunctively }`, and fallback.

## Task 1: Product Organization Pure Helpers

**Files:**
- Create: `src/lib/wizard/product-organization.ts`
- Create: `src/lib/wizard/product-organization.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/wizard/product-organization.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ORGANIZATION_COLLECTIONS,
  mergeOptimizedTags,
  normalizeOrganizationCollections,
} from "./product-organization";

describe("mergeOptimizedTags", () => {
  it("puts optimized tags before current tags and deduplicates case-insensitively", () => {
    assert.deepEqual(
      mergeOptimizedTags([" Patriotic ", "T-Shirt", "", "summer", "mockupai"], ["patriotic", "Gift", "Summer", "draft-preview"]),
      ["Patriotic", "T-Shirt", "summer", "Gift"],
    );
  });

  it("caps merged tags at 15", () => {
    const ai = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    assert.equal(mergeOptimizedTags(ai, ["current"]).length, 15);
  });
});

describe("normalizeOrganizationCollections", () => {
  it("trims, drops blanks, deduplicates case-insensitively, and preserves first casing", () => {
    assert.deepEqual(
      normalizeOrganizationCollections([" T-Shirts ", "t-shirts", "", " Patriotic ", null]),
      ["T-Shirts", "Patriotic"],
    );
  });

  it("returns an empty list for nullish and non-array input", () => {
    assert.deepEqual(normalizeOrganizationCollections(null), []);
    assert.deepEqual(normalizeOrganizationCollections(undefined), []);
    assert.deepEqual(normalizeOrganizationCollections("T-Shirts"), []);
  });

  it("caps collections at the default maximum", () => {
    const values = Array.from({ length: 15 }, (_, i) => `Collection ${i}`);
    assert.equal(normalizeOrganizationCollections(values).length, MAX_ORGANIZATION_COLLECTIONS);
    assert.equal(MAX_ORGANIZATION_COLLECTIONS, 10);
  });
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/product-organization.test.ts
```

Expected: FAIL with module not found for `./product-organization`.

- [ ] **Step 3: Implement helper module**

Create `src/lib/wizard/product-organization.ts`:

```ts
export const MAX_TAGS = 15;
export const MAX_ORGANIZATION_COLLECTIONS = 10;
const INTERNAL_TAG_DENYLIST = new Set(["mockupai", "draft-preview"]);

export function mergeOptimizedTags(aiTags: unknown[], currentTags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of [...aiTags, ...currentTags]) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (INTERNAL_TAG_DENYLIST.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(tag);

    if (out.length >= MAX_TAGS) break;
  }

  return out;
}

export function normalizeOrganizationCollections(
  values: unknown,
  max = MAX_ORGANIZATION_COLLECTIONS,
): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(value);

    if (out.length >= max) break;
  }

  return out;
}
```

- [ ] **Step 4: Run helper tests and verify pass**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/product-organization.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper task**

```bash
git add src/lib/wizard/product-organization.ts src/lib/wizard/product-organization.test.ts
git commit -m "feat: add product organization helpers"
```

## Task 2: AI Provider Organization Optimizer

**Files:**
- Modify: `src/lib/ai/types.ts`
- Modify: `src/lib/ai/providers/shared.ts`
- Modify: `src/lib/ai/providers/gemini.ts`
- Modify: `src/lib/ai/providers/openai.ts`
- Modify: `src/lib/ai/providers/anthropic.ts`
- Create: `src/lib/ai/product-organization.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `src/lib/ai/product-organization.test.ts`:

```ts
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
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/ai/product-organization.test.ts
```

Expected: FAIL because organization helpers are not exported.

- [ ] **Step 3: Add AI types**

In `src/lib/ai/types.ts`, append:

```ts
export interface ProductOrganizationInput {
  title: string;
  descriptionHtml: string;
  productType: string;
  canonicalProductType?: string | null;
  currentTags: string[];
  currentCollections: string[];
  selectedColors: string[];
  designContext?: string | null;
  niche?: string | null;
}

export interface ProductOrganizationOutput {
  tags: string[];
  collections: string[];
  tokensIn: number;
  tokensOut: number;
}

export interface ProductOrganizationOptimizer {
  optimizeProductOrganization(input: ProductOrganizationInput): Promise<ProductOrganizationOutput>;
}
```

- [ ] **Step 4: Add shared prompt, schema, and parser**

In `src/lib/ai/providers/shared.ts`, extend imports and add:

```ts
import { mergeOptimizedTags, normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
import type { ProductOrganizationInput, ProductOrganizationOutput } from "../types";
```

Append:

```ts
export const ORGANIZATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Max 15 short searchable Shopify tags.",
    },
    collections: {
      type: "array",
      items: { type: "string" },
      description: "Broad Shopify Manual Collection title or handle suggestions.",
    },
  },
  required: ["tags", "collections"],
} as const;

export function buildOrganizationUserPrompt(input: ProductOrganizationInput): string {
  return `Generate Shopify SEO tags and manual collection suggestions for this product.
Return strict JSON:
{
  "tags": string[],
  "collections": string[]
}

Rules:
- Max 15 tags.
- Tags must be short searchable Shopify tags.
- Collections should be broad store collection names, not too specific.
- Do not include duplicates.
- Do not include internal tags like mockupai or draft-preview.
- Prefer existing product type, audience, material, print method, niche, occasion.
- Prefer broad collection names such as T-Shirts, Hoodies, Sweatshirts, Patriotic, Gifts, New Arrivals, Men's Clothing, Women's Clothing.

Product:
Title: ${input.title}
Product Type: ${input.productType}
Canonical Product Type: ${input.canonicalProductType ?? ""}
Colors: ${input.selectedColors.join(", ")}
Current Tags: ${input.currentTags.join(", ")}
Current Collections: ${input.currentCollections.join(", ")}
Design Context: ${input.designContext ?? ""}
Niche: ${input.niche ?? ""}
Description HTML:
${input.descriptionHtml}`;
}

export function parseProductOrganizationJson(
  resultText: string,
  usage: { tokensIn: number; tokensOut: number },
): ProductOrganizationOutput {
  const parsed = JSON.parse(extractJsonObject(resultText));
  return {
    tags: mergeOptimizedTags(Array.isArray(parsed.tags) ? parsed.tags : [], []),
    collections: normalizeOrganizationCollections(
      Array.isArray(parsed.collections) ? parsed.collections : [],
    ),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
  };
}
```

- [ ] **Step 5: Add Gemini optimizer method**

In `src/lib/ai/providers/gemini.ts`, update imports:

```ts
import { ContentGenerator, ContentInput, ContentOutput, ProductOrganizationInput, ProductOrganizationOutput } from "../types";
import {
  buildListingUserPrompt,
  buildOrganizationUserPrompt,
  parseListingContentJson,
  parseProductOrganizationJson,
} from "./shared";
```

Add this method inside `GeminiProvider`:

```ts
  async optimizeProductOrganization(
    input: ProductOrganizationInput,
  ): Promise<ProductOrganizationOutput> {
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: buildOrganizationUserPrompt(input),
      config: {
        systemInstruction: this.systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            collections: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["tags", "collections"],
        },
      },
    });

    const resultText = response.text;
    if (!resultText) throw new Error("Empty response from AI");

    return parseProductOrganizationJson(resultText, {
      tokensIn: response.usageMetadata?.promptTokenCount || 0,
      tokensOut: response.usageMetadata?.candidatesTokenCount || 0,
    });
  }
```

- [ ] **Step 6: Add OpenAI optimizer method**

In `src/lib/ai/providers/openai.ts`, update imports:

```ts
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
  ORGANIZATION_JSON_SCHEMA,
  POD_LISTING_JSON_SCHEMA,
} from "./shared";
```

Add this method inside `OpenAiProvider`:

```ts
  async optimizeProductOrganization(
    input: ProductOrganizationInput,
  ): Promise<ProductOrganizationOutput> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        input: [
          { role: "system", content: [{ type: "input_text", text: this.systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: buildOrganizationUserPrompt(input) }] },
        ],
        max_output_tokens: 900,
        text: {
          format: {
            type: "json_schema",
            name: "pod_product_organization",
            strict: true,
            schema: ORGANIZATION_JSON_SCHEMA,
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

    return parseProductOrganizationJson(resultText, {
      tokensIn: data?.usage?.input_tokens ?? 0,
      tokensOut: data?.usage?.output_tokens ?? 0,
    });
  }
```

- [ ] **Step 7: Add Anthropic optimizer method**

In `src/lib/ai/providers/anthropic.ts`, update imports:

```ts
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
```

Add this method inside `AnthropicProvider`:

```ts
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
```

- [ ] **Step 8: Run AI helper tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/ai/product-organization.test.ts src/lib/ai/providers/provider-adapters.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit AI optimizer task**

```bash
git add src/lib/ai/types.ts src/lib/ai/providers/shared.ts src/lib/ai/providers/gemini.ts src/lib/ai/providers/openai.ts src/lib/ai/providers/anthropic.ts src/lib/ai/product-organization.test.ts
git commit -m "feat: add AI product organization optimizer"
```

## Task 3: Wizard AI Config Status And Optimize API

**Files:**
- Create: `src/app/api/wizard/ai-config/status/route.ts`
- Create: `src/app/api/wizard/ai-config/status/route.test.ts`
- Create: `src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.ts`
- Create: `src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts`

- [ ] **Step 1: Write failing source tests**

Create `src/app/api/wizard/ai-config/status/route.test.ts`:

```ts
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
```

Create `src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("optimize product organization route source", () => {
  it("validates session and draft ownership", () => {
    assert.match(source, /validateSession/);
    assert.match(source, /tenantId:\s*session\.tenantId/);
    assert.match(source, /include:\s*\{/);
  });

  it("does not mutate the draft or trust client storeId", () => {
    assert.doesNotMatch(source, /wizardDraft\.update/);
    assert.doesNotMatch(source, /storeId:\s*body\.storeId/);
    assert.match(source, /draft\.store/);
  });

  it("calls the organization optimizer, not listing generate", () => {
    assert.match(source, /optimizeProductOrganization/);
    assert.doesNotMatch(source, /\.generate\(/);
  });
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/ai-config/status/route.test.ts' 'src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts'
```

Expected: FAIL because route files do not exist.

- [ ] **Step 3: Implement AI config status route**

Create `src/app/api/wizard/ai-config/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getProviderEnvKey, normalizeProviderId } from "@/lib/ai/catalog";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });
  const provider = normalizeProviderId(settings?.activeProvider);
  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId: session.tenantId,
        provider,
      },
    },
    select: {
      configured: true,
      apiKeyEncrypted: true,
    },
  });

  const available = Boolean(
    providerSettings?.configured ||
      providerSettings?.apiKeyEncrypted ||
      process.env[getProviderEnvKey(provider)],
  );

  return NextResponse.json({ available, provider });
}
```

- [ ] **Step 4: Implement optimize route**

Create `src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai/factory";
import { parseAIError } from "@/lib/ai/errors";
import type { ProductOrganizationInput, ProductOrganizationOptimizer } from "@/lib/ai/types";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { normalizeProductType } from "@/lib/publish/shopify";
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";

type RequestBody = {
  title?: string;
  descriptionHtml?: string;
  productType?: string;
  canonicalProductType?: string | null;
  currentTags?: unknown[];
  currentCollections?: unknown[];
  selectedColors?: unknown[];
  designContext?: string | null;
  niche?: string | null;
};

function isOrganizationOptimizer(value: unknown): value is ProductOrganizationOptimizer {
  return Boolean(
    value &&
      typeof value === "object" &&
      "optimizeProductOrganization" in value &&
      typeof (value as ProductOrganizationOptimizer).optimizeProductOrganization === "function",
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;
  const body = (await request.json().catch(() => ({}))) as RequestBody;

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
    include: {
      design: true,
      draftDesigns: { orderBy: { sortOrder: "asc" }, include: { design: true } },
      store: { include: { colors: true } },
      template: true,
    },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const aiContent = (draft.aiContent ?? {}) as {
    title?: string;
    description?: string;
    tags?: string[];
    collections?: string[];
  };
  const productType = draft.template?.blueprintTitle || body.productType || "T-Shirt";
  const canonicalProductType = body.canonicalProductType ?? normalizeProductType(productType);
  const selectedColors =
    draft.store?.colors
      ?.filter((color) => (draft.enabledColorIds ?? []).includes(color.id))
      .map((color) => color.name) ?? [];
  const primaryDesign = draft.draftDesigns[0]?.design ?? draft.design;

  const input: ProductOrganizationInput = {
    title: body.title ?? aiContent.title ?? "",
    descriptionHtml: body.descriptionHtml ?? aiContent.description ?? "",
    productType,
    canonicalProductType,
    currentTags: Array.isArray(body.currentTags)
      ? body.currentTags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
      : aiContent.tags ?? [],
    currentCollections: normalizeOrganizationCollections(
      Array.isArray(body.currentCollections) ? body.currentCollections : aiContent.collections ?? [],
    ),
    selectedColors: selectedColors.length > 0
      ? selectedColors
      : Array.isArray(body.selectedColors)
        ? body.selectedColors.map((color) => String(color ?? "").trim()).filter(Boolean)
        : [],
    designContext: body.designContext ?? primaryDesign?.name ?? null,
    niche: body.niche ?? null,
  };

  try {
    const { generator } = await getAiProvider(session.tenantId);
    if (!isOrganizationOptimizer(generator)) {
      return NextResponse.json(
        { error: "optimizer_unavailable", message: "AI provider không hỗ trợ tối ưu organization." },
        { status: 500 },
      );
    }

    const result = await generator.optimizeProductOrganization(input);
    return NextResponse.json({ tags: result.tags, collections: result.collections });
  } catch (error) {
    const parsed = parseAIError(error);
    return NextResponse.json(
      { error: parsed.code, message: parsed.userMessage, retryable: parsed.retryable },
      { status: parsed.retryable ? 503 : 500 },
    );
  }
}
```

- [ ] **Step 5: Run route tests and verify pass**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/ai-config/status/route.test.ts' 'src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit API task**

```bash
git add 'src/app/api/wizard/ai-config/status/route.ts' 'src/app/api/wizard/ai-config/status/route.test.ts' 'src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.ts' 'src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts'
git commit -m "feat: add product organization optimize API"
```

## Task 4: Step 4 Manual Edit UI And Save Behavior

**Files:**
- Modify: `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`
- Create: `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`

- [ ] **Step 1: Write failing Step 4 source tests**

Create `src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Step 4 product organization UI source", () => {
  it("shows optimize only in the real manual-edit state", () => {
    assert.match(source, /manual-edit/);
    assert.match(source, /Tối ưu tags & collections/);
    assert.match(source, /state\s*===\s*"manual-edit"/);
  });

  it("calls the optimize route separately from generate content", () => {
    assert.match(source, /optimize-product-organization/);
    assert.match(source, /generate-content/);
    assert.match(source, /async function handleGenerateAI\(\)[\s\S]*generate-content/);
    assert.match(source, /async function handleOptimizeOrganization\(\)[\s\S]*optimize-product-organization/);
    const beforeOptimizeHandler = source.split("async function handleOptimizeOrganization")[0] ?? source;
    assert.doesNotMatch(beforeOptimizeHandler, /optimize-product-organization/);
  });

  it("keeps manual edits local until Save", () => {
    assert.match(source, /state !== "manual-edit"/);
    assert.match(source, /handleSaveManual/);
    assert.match(source, /collections/);
  });
});
```

- [ ] **Step 2: Run Step 4 source test and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: FAIL because optimize UI/route and collection handling are absent.

- [ ] **Step 3: Update imports and content type**

In `src/app/(authed)/wizard/[draftId]/step-4/page.tsx`, add:

```ts
import { toast } from "sonner";
import {
  MAX_TAGS,
  mergeOptimizedTags,
  normalizeOrganizationCollections,
} from "@/lib/wizard/product-organization";
```

Remove the local `const MAX_TAGS = 15`.

Extend `AiContent`:

```ts
interface AiContent {
  title: string;
  description: string;
  tags: string[];
  collections: string[];
  altText: string;
  source?: "ai" | "manual";
}
```

- [ ] **Step 4: Add collection and AI config state**

In the initial `content` state and sync from `existing`, include:

```ts
collections: normalizeOrganizationCollections(existing?.collections || []),
```

Add component state:

```ts
const [collectionInput, setCollectionInput] = useState("");
const [optimizing, setOptimizing] = useState(false);
const [aiConfigAvailable, setAiConfigAvailable] = useState(false);
```

Add an effect:

```ts
useEffect(() => {
  let cancelled = false;
  fetch("/api/wizard/ai-config/status")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!cancelled) setAiConfigAvailable(Boolean(data?.available));
    })
    .catch(() => {
      if (!cancelled) setAiConfigAvailable(false);
    });
  return () => {
    cancelled = true;
  };
}, []);
```

- [ ] **Step 5: Stop auto-saving manual edit content**

Replace the current auto-sync effect with:

```ts
useEffect(() => {
  if (state === "ready") {
    updateDraft({ aiContent: content });
  }
}, [content, state, updateDraft]);
```

This keeps `manual-edit` changes local until Save/Next.

- [ ] **Step 6: Add optimize and collection handlers**

Add these functions in Step 4:

```ts
async function handleOptimizeOrganization() {
  setOptimizing(true);
  try {
    const res = await fetch(`/api/wizard/drafts/${draftId}/ai/optimize-product-organization`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: content.title,
        descriptionHtml: content.description,
        productType: draft?.template?.blueprintTitle ?? draft?.store?.template?.blueprintTitle ?? "",
        canonicalProductType: null,
        currentTags: content.tags,
        currentCollections: content.collections,
        designContext: draft?.design?.name ?? null,
        niche: null,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.message || "Không thể tối ưu tags & collections");
    }

    setContent((current) => ({
      ...current,
      tags: mergeOptimizedTags(data?.tags ?? [], current.tags),
      collections: normalizeOrganizationCollections([
        ...(Array.isArray(data?.collections) ? data.collections : []),
        ...current.collections,
      ]),
    }));
    toast.success("Đã tối ưu tags & collections. Bấm Lưu để áp dụng.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Không thể tối ưu tags & collections");
  } finally {
    setOptimizing(false);
  }
}

function addCollection() {
  setContent((current) => ({
    ...current,
    collections: normalizeOrganizationCollections([...current.collections, collectionInput]),
  }));
  setCollectionInput("");
}

function removeCollection(collection: string) {
  setContent((current) => ({
    ...current,
    collections: current.collections.filter((item) => item !== collection),
  }));
}
```

- [ ] **Step 7: Normalize on save and add collection UI**

In `handleSaveManual()`, write normalized content:

```ts
const manualContent = {
  ...content,
  tags: mergeOptimizedTags([], content.tags),
  collections: normalizeOrganizationCollections(content.collections),
  source: "manual" as const,
};
updateDraft({ aiContent: manualContent });
await useWizardStore.getState().saveDraftImmediately();
setContent(manualContent);
setState("ready");
```

In the Tags label block, render the optimize button only in manual edit mode:

```tsx
<div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
  <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>
    Tags ({content.tags.length}/{MAX_TAGS})
    {content.tags.length >= MAX_TAGS && (
      <span style={{ color: "var(--color-warning, #f59e0b)", fontWeight: 400, marginLeft: 8, fontSize: "0.78rem" }}>
        Đã đạt giới hạn Shopify
      </span>
    )}
  </label>
  {state === "manual-edit" && aiConfigAvailable && (
    <button
      className="btn btn-secondary"
      onClick={handleOptimizeOrganization}
      disabled={optimizing}
      style={{ fontSize: "0.78rem" }}
    >
      {optimizing ? <Loader2 size={14} className="animate-spin" /> : null}
      {optimizing ? "Đang tối ưu..." : "✨ Tối ưu tags & collections"}
    </button>
  )}
</div>
```

Add the Collections block after Tags:

```tsx
{state === "manual-edit" && (
  <div>
    <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 6 }}>
      Collections ({content.collections.length}/10)
    </label>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
      {content.collections.map((collection) => (
        <span key={collection} className="flex items-center gap-1" style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-tertiary)", fontSize: "0.78rem", fontWeight: 500 }}>
          {collection}
          <button onClick={() => removeCollection(collection)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", opacity: 0.5 }}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
    <div className="flex gap-2">
      <input
        type="text"
        className="input"
        value={collectionInput}
        onChange={(event) => setCollectionInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addCollection();
          }
        }}
        placeholder="Thêm collection..."
        style={{ flex: 1 }}
        disabled={content.collections.length >= 10}
      />
      <button className="btn btn-secondary" onClick={addCollection} disabled={content.collections.length >= 10} style={{ fontSize: "0.8rem" }}>
        <Plus size={14} /> Thêm
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 8: Run Step 4 tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/product-organization.test.ts 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
```

Expected: PASS.

- [ ] **Step 9: Commit Step 4 task**

```bash
git add 'src/app/(authed)/wizard/[draftId]/step-4/page.tsx' 'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts'
git commit -m "feat: add manual product organization optimizer UI"
```

## Task 5: Listing Snapshot Schema And Publish API

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260615000000_add_listing_organization_collections/migration.sql`
- Modify: `src/app/api/wizard/drafts/[id]/publish/route.ts`
- Create: `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`

- [ ] **Step 1: Write failing publish source test**

Create `src/app/api/wizard/drafts/[id]/publish-route-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./publish/route.ts", import.meta.url), "utf8");

describe("wizard publish listing organization snapshot source", () => {
  it("reads aiContent collections and snapshots them to Listing", () => {
    assert.match(source, /collections\?:\s*string\[\]/);
    assert.match(source, /organizationCollections/);
    assert.match(source, /normalizeOrganizationCollections/);
  });
});
```

- [ ] **Step 2: Run source test and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: FAIL because `organizationCollections` is not used.

- [ ] **Step 3: Add Prisma field and migration**

In `prisma/schema.prisma`, add to `model Listing` near `tags`:

```prisma
  organizationCollections String[] @default([]) @map("organization_collections")
```

Create `prisma/migrations/20260615000000_add_listing_organization_collections/migration.sql`:

```sql
ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "organization_collections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

If Prisma rejects scalar lists for the datasource despite `Listing.tags String[]` already existing, change the schema field to:

```prisma
  organizationCollections Json @default("[]") @map("organization_collections")
```

and change the migration to:

```sql
ALTER TABLE "listings"
  ADD COLUMN IF NOT EXISTS "organization_collections" JSONB NOT NULL DEFAULT '[]'::jsonb;
```

- [ ] **Step 4: Copy normalized collections during listing creation**

In `src/app/api/wizard/drafts/[id]/publish/route.ts`, import:

```ts
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
```

Extend the local `aiContent` type:

```ts
const aiContent = draft.aiContent as {
  title?: string;
  description?: string;
  tags?: string[];
  collections?: string[];
} | null;
```

Add to `prisma.listing.create({ data: { ... } })`:

```ts
organizationCollections: normalizeOrganizationCollections(aiContent.collections ?? []),
```

- [ ] **Step 5: Generate Prisma client**

Run:

```bash
npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 6: Run publish source test**

Run:

```bash
./node_modules/.bin/tsx --test 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Commit snapshot task**

```bash
git add prisma/schema.prisma prisma/migrations/20260615000000_add_listing_organization_collections/migration.sql 'src/app/api/wizard/drafts/[id]/publish/route.ts' 'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts'
git commit -m "feat: snapshot organization collections on listings"
```

## Task 6: Shopify Manual Collection Resolution

**Files:**
- Modify: `src/lib/publish/shopify.ts`
- Modify: `src/lib/publish/shopify.test.ts`

- [ ] **Step 1: Add failing Shopify collection tests**

In `src/lib/publish/shopify.test.ts`, update imports:

```ts
import {
  buildProductTags,
  normalizeProductType,
  resolveProductCollectionIds,
} from "./shopify";
```

Append:

```ts
describe("resolveProductCollectionIds", () => {
  it("prefers optimized Manual Collections over canonical fallback", async () => {
    const calls: unknown[] = [];
    const client = {
      graphql: async (_query: string, variables: Record<string, unknown>) => {
        calls.push(variables);
        return {
          collections: {
            nodes: [
              { id: "gid://shopify/Collection/1", title: "Patriotic", handle: "patriotic", ruleSet: null },
              { id: "gid://shopify/Collection/2", title: "T-Shirts", handle: "t-shirts", ruleSet: null },
            ],
          },
        };
      },
    };

    assert.deepEqual(
      await resolveProductCollectionIds(client as any, "T-Shirt", [" Patriotic ", "patriotic"]),
      ["gid://shopify/Collection/1"],
    );
    assert.equal(calls.length, 1);
  });

  it("resolves apostrophe collection names through handles", async () => {
    let queryValue = "";
    const client = {
      graphql: async (_query: string, variables: Record<string, unknown>) => {
        queryValue = String(variables.q ?? "");
        return {
          collections: {
            nodes: [
              {
                id: "gid://shopify/Collection/mens",
                title: "Men's Clothing",
                handle: "mens-clothing",
                ruleSet: null,
              },
            ],
          },
        };
      },
    };

    assert.deepEqual(
      await resolveProductCollectionIds(client as any, "T-Shirt", ["Men's Clothing"]),
      ["gid://shopify/Collection/mens"],
    );
    assert.match(queryValue, /handle:mens-clothing/);
    assert.doesNotMatch(queryValue, /Men\\'s Clothing/);
  });

  it("ignores Smart Collections and falls back to product type collection", async () => {
    let call = 0;
    const client = {
      graphql: async () => {
        call += 1;
        if (call === 1) {
          return {
            collections: {
              nodes: [
                {
                  id: "gid://shopify/Collection/smart",
                  title: "Patriotic",
                  handle: "patriotic",
                  ruleSet: { appliedDisjunctively: false },
                },
              ],
            },
          };
        }
        return {
          collections: {
            nodes: [
              { id: "gid://shopify/Collection/fallback", title: "T-Shirts", handle: "t-shirts", ruleSet: null },
            ],
          },
        };
      },
    };

    assert.deepEqual(
      await resolveProductCollectionIds(client as any, "T-Shirt", ["Patriotic"]),
      ["gid://shopify/Collection/fallback"],
    );
  });

  it("documents ruleSet appliedDisjunctively selection", () => {
    const source = readFileSync(new URL("./shopify.ts", import.meta.url), "utf8");
    assert.match(source, /ruleSet\s*\{\s*appliedDisjunctively\s*\}/);
    assert.doesNotMatch(source, /ruleSet\s*\{\s*id\s*\}/);
  });
});
```

- [ ] **Step 2: Run Shopify tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts
```

Expected: FAIL because `resolveProductCollectionIds` is not exported.

- [ ] **Step 3: Add publish input field**

In `src/lib/publish/shopify.ts`, extend `ShopifyPublishInput`:

```ts
  organizationCollections?: string[];
```

- [ ] **Step 4: Add resolver helpers**

In `src/lib/publish/shopify.ts`, import:

```ts
import { normalizeOrganizationCollections } from "@/lib/wizard/product-organization";
```

Add:

```ts
type CollectionResolverClient = Pick<ShopifyClient, "graphql">;

export async function resolveProductCollectionIds(
  client: CollectionResolverClient,
  canonicalType: string | null,
  organizationCollections: unknown = [],
): Promise<string[]> {
  const aiCollectionIds = await resolveManualCollectionIdsByTitlesOrHandles(
    client,
    normalizeOrganizationCollections(organizationCollections),
  );
  if (aiCollectionIds.length > 0) return aiCollectionIds;
  return resolveCollectionIds(client, canonicalType);
}

async function resolveManualCollectionIdsByTitlesOrHandles(
  client: CollectionResolverClient,
  values: unknown,
): Promise<string[]> {
  const names = normalizeOrganizationCollections(values);
  if (names.length === 0) return [];

  try {
    const queries = names.map((value) => `handle:${toHandle(value)}`);
    const query = `
      query FindManualCollections($q: String!) {
        collections(first: 50, query: $q) {
          nodes {
            id
            title
            handle
            ruleSet { appliedDisjunctively }
          }
        }
      }
    `;
    const data = (await client.graphql(query, { q: queries.join(" OR ") })) as {
      collections: {
        nodes: Array<{
          id: string;
          title: string;
          handle: string;
          ruleSet: { appliedDisjunctively: boolean } | null;
        }>;
      };
    };

    const out: string[] = [];
    const seenIds = new Set<string>();
    for (const value of names) {
      const key = value.toLowerCase();
      const handle = toHandle(value);
      const match = data.collections.nodes.find(
        (collection) =>
          collection.ruleSet === null &&
          (collection.title.toLowerCase() === key || collection.handle.toLowerCase() === handle),
      );
      if (match && !seenIds.has(match.id)) {
        seenIds.add(match.id);
        out.push(match.id);
      }
    }
    return out;
  } catch (err) {
    console.warn(
      "[Shopify] Manual collection resolve failed, falling back:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
```

Update existing `resolveCollectionIds()` signature to accept `CollectionResolverClient`:

```ts
async function resolveCollectionIds(
  client: CollectionResolverClient,
  canonicalType: string | null,
): Promise<string[]> {
```

- [ ] **Step 5: Wire resolver into productSet**

Replace current collection resolution in `createProductWithSet()`:

```ts
const [categoryId, collectionIds, locationId] = await Promise.all([
  resolveCategoryId(client, canonicalType),
  resolveCollectionIds(client, canonicalType),
  resolveDefaultLocationId(client),
]);
```

with:

```ts
const [categoryId, collectionIds, locationId] = await Promise.all([
  resolveCategoryId(client, canonicalType),
  resolveProductCollectionIds(client, canonicalType, input.organizationCollections ?? []),
  resolveDefaultLocationId(client),
]);
```

- [ ] **Step 6: Run Shopify tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/shopify.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Shopify resolver task**

```bash
git add src/lib/publish/shopify.ts src/lib/publish/shopify.test.ts
git commit -m "feat: prefer manual organization collections on Shopify publish"
```

## Task 7: Worker Passes Listing Collection Snapshot

**Files:**
- Modify: `src/lib/publish/worker.ts`
- Modify: `src/lib/publish/worker.test.ts`

- [ ] **Step 1: Add failing worker source test**

Update the import block at the top of `src/lib/publish/worker.test.ts`:

```ts
import { readFileSync } from "node:fs";
```

Keep the existing `assert`, `describe`, and `it` imports. Only add `readFileSync` as a new top-level import. Then append:

```ts
describe("runPublishWorker organization collections source", () => {
  const source = readFileSync(new URL("./worker.ts", import.meta.url), "utf8");

  it("passes listing organizationCollections to Shopify publish", () => {
    assert.match(source, /organizationCollections:\s*listing\.organizationCollections/);
  });
});
```

- [ ] **Step 2: Run worker tests and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: FAIL because worker does not pass `organizationCollections`.

- [ ] **Step 3: Pass snapshot into Shopify publish**

In `src/lib/publish/worker.ts`, add to the `publishToShopify()` input:

```ts
organizationCollections: listing.organizationCollections ?? [],
```

Do not read draft `aiContent.collections` in the worker.

- [ ] **Step 4: Run worker tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/publish/worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit worker task**

```bash
git add src/lib/publish/worker.ts src/lib/publish/worker.test.ts
git commit -m "feat: pass listing organization collections to Shopify"
```

## Task 8: Regression Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/wizard/product-organization.test.ts \
  src/lib/ai/product-organization.test.ts \
  'src/app/api/wizard/ai-config/status/route.test.ts' \
  'src/app/api/wizard/drafts/[id]/ai/optimize-product-organization/route.test.ts' \
  'src/app/(authed)/wizard/[draftId]/step-4/page-source.test.ts' \
  'src/app/api/wizard/drafts/[id]/publish-route-source.test.ts' \
  src/lib/publish/shopify.test.ts \
  src/lib/publish/worker.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Prisma validation/generation**

Run:

```bash
npx prisma validate
npx prisma generate
```

Expected: both commands succeed. If Prisma rejects `String[]` for `organizationCollections`, use the JSON fallback described in Task 5 and rerun both commands.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Check for accidental optimize calls in generate flow**

Run:

```bash
rg -n "optimize-product-organization|optimizeProductOrganization" 'src/app/api/wizard/drafts/[id]/generate-content/route.ts' 'src/app/(authed)/wizard/[draftId]/step-4/page.tsx'
```

Expected: no matches in `generate-content/route.ts`; matches in Step 4 only inside optimize handler.

- [ ] **Step 5: Check Git diff for unrelated churn**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status includes only files from this plan plus pre-existing unrelated dirty files.

- [ ] **Step 6: Confirm no uncommitted plan changes remain**

Run:

```bash
git status --short
```

Expected: no uncommitted files from this plan remain. If a verification step changed a file, return to the task that owns that file, rerun that task's focused tests, and use that task's commit step.
