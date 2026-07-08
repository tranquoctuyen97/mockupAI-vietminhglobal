# Design Pair Name Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wizard light/dark pairing understand names like `ver sáng 1`, `ver tối 1`, `ver_sang_tên mẫu`, and `ver_toi_tên mẫu`.

**Architecture:** Keep all behavior in the existing shared parser, `src/lib/designs/design-pairing.ts`, so Step 2 preview and draft persistence automatically agree. No UI, schema, or publish changes.

**Tech Stack:** TypeScript, Next.js app code, `node:test`.

---

### Task 1: Extend Design Pair Parser

**Files:**
- Modify: `src/lib/designs/design-pairing.ts`
- Modify: `src/lib/designs/design-pairing.test.ts`

- [ ] **Step 1: Add failing parser and pair tests**

Add tests covering internal marker, underscore customer format, prefix marker, and existing suffix behavior:

```ts
test("parseDesignName detects internal Vietnamese markers", () => {
  assert.deepEqual(parseDesignName("ver sáng 1"), {
    baseName: "ver 1",
    type: "LIGHT",
    originalSuffix: "sáng",
  });
  assert.deepEqual(parseDesignName("ver tối 1"), {
    baseName: "ver 1",
    type: "DARK",
    originalSuffix: "tối",
  });
});

test("parseDesignName detects underscore customer format", () => {
  assert.deepEqual(parseDesignName("ver_sang_tên mẫu.png"), {
    baseName: "ver tên mẫu",
    type: "LIGHT",
    originalSuffix: "sang",
  });
  assert.deepEqual(parseDesignName("ver_toi_tên mẫu.png"), {
    baseName: "ver tên mẫu",
    type: "DARK",
    originalSuffix: "toi",
  });
});

test("parseDesignName detects prefix markers", () => {
  assert.deepEqual(parseDesignName("sáng tên mẫu"), {
    baseName: "tên mẫu",
    type: "LIGHT",
    originalSuffix: "sáng",
  });
  assert.deepEqual(parseDesignName("tối tên mẫu"), {
    baseName: "tên mẫu",
    type: "DARK",
    originalSuffix: "tối",
  });
});

test("pairDesigns pairs internal and underscore marker names", () => {
  const result = pairDesigns([
    { id: "light-1", name: "ver sáng 1" },
    { id: "dark-1", name: "ver tối 1" },
    { id: "light-2", name: "ver_sang_tên mẫu" },
    { id: "dark-2", name: "ver_toi_tên mẫu" },
  ]);

  assert.deepEqual(result.pairs.map((pair) => pair.baseName), ["ver 1", "ver tên mẫu"]);
  assert.deepEqual(result.unpaired, []);
  assert.deepEqual(result.independent, []);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/designs/design-pairing.test.ts
```

Expected: the new internal/prefix tests fail before implementation.

- [ ] **Step 3: Implement minimal parser change**

Replace suffix-only parsing with token-position parsing:

```ts
type NameToken = {
  raw: string;
  start: number;
  end: number;
};

function markerType(token: string): DesignVariantType | null {
  const normalized = normalizeToken(token);
  if (LIGHT_TOKENS.includes(normalized)) return "LIGHT";
  if (DARK_TOKENS.includes(normalized)) return "DARK";
  return null;
}

function tokenizeName(name: string): NameToken[] {
  const tokens: NameToken[] = [];
  const matches = name.matchAll(/[^\s_\-–—·]+/g);
  for (const match of matches) {
    const start = match.index ?? 0;
    const raw = match[0].replace(BRACKET_STRIP, "");
    if (!raw) continue;
    tokens.push({ raw, start, end: start + match[0].length });
  }
  return tokens;
}

function baseNameWithoutToken(name: string, token: NameToken): string {
  return `${name.slice(0, token.start)} ${name.slice(token.end)}`
    .replace(/[\s_\-–—·()[\]]+/g, " ")
    .trim();
}
```

Then `parseDesignName()` uses `tokenizeName(name)`, checks every token for `markerType()`, and returns the first marker that leaves a non-empty base name.

- [ ] **Step 4: Run focused test**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/designs/design-pairing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Check changed files**

Run:

```bash
git diff -- src/lib/designs/design-pairing.ts src/lib/designs/design-pairing.test.ts docs/superpowers/specs/2026-07-08-design-pair-name-parser-design.md docs/superpowers/plans/2026-07-08-design-pair-name-parser.md
```

Expected: only parser, tests, spec, and plan changed.
