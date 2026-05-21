# Wizard Template Selection and Mockup Job Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Wizard Step 3 choose a mockup template per draft and make official mockup generation stop deterministically instead of spinning forever.

**Architecture:** The Wizard will load all store templates, select one per draft via `templateId`, and derive colors/sizes/placement from that selected template. Mockup generation keeps using the existing `draft.template` backend path, but adds server-side readiness validation and timeout handling. PM2 runs a dedicated worker process, and `start-worker.ts` starts the Printify poll worker so `printify-mockup-poll-queue` is consumed outside the Next.js web process.

**Tech Stack:** Next.js App Router, React client components, Prisma, BullMQ, PM2, node:test, TypeScript.

**Commit policy:** Do not commit. User explicitly requested no commit in this thread.

---

## Files

Modify:

- `ecosystem.config.js` - add dedicated PM2 worker process.
- `start-worker.ts` - start Printify mockup poll worker and close it on shutdown.
- `src/app/api/stores/[id]/mockup-templates/route.ts` - add `GET` template list endpoint.
- `src/lib/wizard/use-wizard-store.ts` - add `templateId` and `store.templates` client types.
- `src/lib/wizard/state.ts` - validate template ownership and mark mockups stale on template change.
- `src/lib/wizard/state.test.ts` - add source-level/state tests for template id and stale behavior.
- `src/app/(authed)/wizard/[draftId]/step-1/page.tsx` - reset `templateId` when store changes.
- `src/app/(authed)/wizard/[draftId]/step-3/page.tsx` - add template selector, selected-template fetch logic, and no-progress warning.
- `src/app/api/mockup-jobs/route.ts` - validate selected template readiness and color membership before enqueueing.
- `src/app/api/mockup-jobs/[id]/route.ts` - mark stalled jobs failed on poll.

Create:

- `src/lib/mockup/job-timeout.ts` - timeout constants and helper.
- `src/lib/mockup/job-timeout.test.ts` - timeout helper tests.
- `src/app/api/stores/[id]/mockup-templates/route.test.ts` - source-level test for GET/readiness serialization if DB route integration tests are not available.
- `src/start-worker.test.ts` or `src/lib/queue/workers/start-worker-source.test.ts` - source-level test that the worker entrypoint starts Printify poll worker.

---

## Task 1: PM2 Worker Process and Worker Entrypoint

**Files:**

- Modify: `ecosystem.config.js`
- Modify: `start-worker.ts`
- Create: `src/lib/queue/workers/start-worker-source.test.ts`

- [ ] **Step 1: Add source test for Printify poll worker startup**

Create `src/lib/queue/workers/start-worker-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("standalone worker entrypoint starts the Printify mockup poll worker", () => {
  const source = readFileSync(join(process.cwd(), "start-worker.ts"), "utf8");

  assert.match(source, /startPrintifyMockupPollWorker/);
  assert.match(source, /const\s+printifyMockupPollWorker\s*=/);
  assert.match(source, /printifyMockupPollWorker\.close\(\)/);
});

test("PM2 ecosystem includes a dedicated worker process", () => {
  const source = readFileSync(join(process.cwd(), "ecosystem.config.js"), "utf8");

  assert.match(source, /name:\s*["']mockupai-worker["']/);
  assert.match(source, /args:\s*["']run worker["']/);
});
```

- [ ] **Step 2: Run the failing source test**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/queue/workers/start-worker-source.test.ts
```

Expected: fails because `start-worker.ts` does not start `startPrintifyMockupPollWorker`, and `ecosystem.config.js` has no worker app.

- [ ] **Step 3: Update `start-worker.ts`**

Replace the file with:

```ts
import { startTripleWhaleSyncWorker } from "./src/lib/jobs/workers/triple-whale-sync-worker";
import { startPrintifyMockupPollWorker } from "./src/lib/mockup/printify-poll-worker";
import { startMockupCompositeWorker } from "./src/lib/mockup/worker";

console.log("Starting BullMQ workers...");

const mockupWorker = startMockupCompositeWorker();
const printifyMockupPollWorker = startPrintifyMockupPollWorker();
const tripleWhaleSyncWorker = startTripleWhaleSyncWorker();

mockupWorker.on("ready", () => {
  console.log("Mockup composite worker is ready and listening to queue.");
});

printifyMockupPollWorker.on("ready", () => {
  console.log("Printify mockup poll worker is ready and listening to queue.");
});

tripleWhaleSyncWorker.on("ready", () => {
  console.log("Triple Whale sync worker is ready and listening to queue.");
});

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    mockupWorker.close(),
    printifyMockupPollWorker.close(),
    tripleWhaleSyncWorker.close(),
  ]);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown().catch((error) => {
    console.error("Worker shutdown failed:", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown().catch((error) => {
    console.error("Worker shutdown failed:", error);
    process.exit(1);
  });
});
```

- [ ] **Step 4: Update `ecosystem.config.js`**

Replace the single-app config with:

```js
module.exports = {
  apps: [
    {
      name: "mockupai",
      interpreter: "bash",
      script: "./start.sh",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      error_file: "/var/log/pm2/mockupai-error.log",
      out_file: "/var/log/pm2/mockupai-out.log",
    },
    {
      name: "mockupai-worker",
      script: "npm",
      args: "run worker",
      cwd: ".",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      error_file: "/var/log/pm2/mockupai-worker-error.log",
      out_file: "/var/log/pm2/mockupai-worker-out.log",
    },
  ],
};
```

- [ ] **Step 5: Run worker source test**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/queue/workers/start-worker-source.test.ts
```

Expected: pass.

---

## Task 2: Template List API for Wizard

**Files:**

- Modify: `src/app/api/stores/[id]/mockup-templates/route.ts`
- Create: `src/app/api/stores/[id]/mockup-templates/route.test.ts`

- [ ] **Step 1: Add source-level test for GET endpoint**

Create `src/app/api/stores/[id]/mockup-templates/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const routePath = "src/app/api/stores/[id]/mockup-templates/route.ts";

test("mockup templates route exposes GET with readiness and colors", () => {
  const source = readFileSync(join(process.cwd(), routePath), "utf8");

  assert.match(source, /export\s+async\s+function\s+GET/);
  assert.match(source, /getTemplateReadiness/);
  assert.match(source, /getTemplateReadinessLabel/);
  assert.match(source, /include:\s*{\s*colors:\s*{/);
  assert.match(source, /return\s+NextResponse\.json\(\{\s*templates/);
});
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/[id]/mockup-templates/route.test.ts
```

Expected: fails because route has no GET.

- [ ] **Step 3: Add GET implementation**

In `src/app/api/stores/[id]/mockup-templates/route.ts`, import readiness helpers:

```ts
import {
  getTemplateReadiness,
  getTemplateReadinessLabel,
} from "@/lib/stores/template-readiness";
```

Add this handler before `POST`:

```ts
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: storeId } = await params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId },
    include: {
      templates: {
        orderBy: { sortOrder: "asc" },
        include: {
          colors: {
            orderBy: { sortOrder: "asc" },
            include: { color: true },
          },
        },
      },
    },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const templates = store.templates.map((template) => {
    const readiness = getTemplateReadiness(template);
    return {
      id: template.id,
      name: template.name,
      isDefault: template.isDefault,
      sortOrder: template.sortOrder,
      printifyBlueprintId: template.printifyBlueprintId,
      printifyPrintProviderId: template.printifyPrintProviderId,
      blueprintTitle: template.blueprintTitle,
      printProviderTitle: template.printProviderTitle,
      enabledVariantIds: template.enabledVariantIds,
      enabledSizes: template.enabledSizes,
      defaultPlacement: template.defaultPlacement,
      readiness: {
        ready: readiness.ready,
        missing: readiness.missing,
        label: getTemplateReadinessLabel(template),
      },
      colors: template.colors.map((entry) => ({
        id: entry.color.id,
        name: entry.color.name,
        hex: entry.color.hex,
        enabled: entry.color.enabled,
        sortOrder: entry.sortOrder,
      })),
    };
  });

  return NextResponse.json({ templates });
}
```

- [ ] **Step 4: Run endpoint source test**

Run:

```bash
./node_modules/.bin/tsx --test src/app/api/stores/[id]/mockup-templates/route.test.ts
```

Expected: pass.

---

## Task 3: Draft State Template Safety

**Files:**

- Modify: `src/lib/wizard/use-wizard-store.ts`
- Modify: `src/lib/wizard/state.ts`
- Modify: `src/lib/wizard/state.test.ts`
- Modify: `src/app/(authed)/wizard/[draftId]/step-1/page.tsx`

- [ ] **Step 1: Add source tests for draft template support**

Append to `src/lib/wizard/state.test.ts`:

```ts
test("wizard draft state accepts templateId patches", () => {
  const sanitized = sanitizeDraftPatch({
    templateId: "template_1",
    enabledSizes: ["S", "M"],
    unknownTemplateField: "drop",
  });

  assert.deepEqual(sanitized, {
    templateId: "template_1",
    enabledSizes: ["S", "M"],
  });
});

test("updateDraft marks mockups stale when template changes", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/wizard/state.ts"), "utf8");

  assert.match(source, /templateChanged/);
  assert.match(source, /mockupsStale:\s*true/);
  assert.match(source, /mockupsStaleReason:\s*"template_changed"/);
});

test("step 1 resets templateId when store changes", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(authed)/wizard/[draftId]/step-1/page.tsx"),
    "utf8",
  );

  assert.match(source, /templateId:\s*null/);
});
```

- [ ] **Step 2: Run tests and confirm new source assertions fail**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/state.test.ts
```

Expected: some tests fail until implementation is added.

- [ ] **Step 3: Update client draft types**

In `src/lib/wizard/use-wizard-store.ts`, add `templateId` to `DraftData`:

```ts
  templateId: string | null;
```

Extend `store` type with templates:

```ts
    templates?: Array<{
      id: string;
      name: string;
      isDefault: boolean;
      blueprintTitle?: string;
      printProviderTitle?: string;
      defaultPlacement?: unknown;
      enabledVariantIds?: number[];
      enabledSizes?: string[];
    }>;
```

- [ ] **Step 4: Mark template changes stale in server state**

In `src/lib/wizard/state.ts`, before `return prisma.wizardDraft.update`, compute:

```ts
  const nextTemplateId =
    sanitized.templateId !== undefined ? sanitized.templateId : draft.templateId;
  const templateChanged =
    sanitized.templateId !== undefined && sanitized.templateId !== draft.templateId;
  const enabledSizesChanged =
    sanitized.enabledSizes !== undefined &&
    JSON.stringify(sanitized.enabledSizes ?? []) !== JSON.stringify(draft.enabledSizes ?? []);
```

If `sanitized.templateId` is provided and not `null`, validate ownership:

```ts
  if (sanitized.templateId) {
    const storeId = sanitized.storeId ?? draft.storeId;
    const template = await prisma.storeMockupTemplate.findFirst({
      where: {
        id: sanitized.templateId,
        storeId: storeId ?? undefined,
        store: { tenantId },
      },
      select: { id: true },
    });

    if (!template) {
      throw new Error("Template not found for draft store");
    }
  }
```

Add stale fields inside update data:

```ts
      ...(templateChanged || enabledSizesChanged
        ? {
            mockupsStale: true,
            mockupsStaleReason: templateChanged ? "template_changed" : "colors_changed",
          }
        : {}),
```

Remove `nextTemplateId` if unused after implementation.

- [ ] **Step 5: Reset `templateId` on store change**

In `src/app/(authed)/wizard/[draftId]/step-1/page.tsx`, update `handleSelect` patch:

```ts
    updateDraft({
      storeId,
      templateId: null,
      enabledColorIds: [],
      enabledSizes: [],
      enabledVariantIdsOverride: [],
      placementOverride: null,
    });
```

- [ ] **Step 6: Run draft state tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/state.test.ts
```

Expected: pass.

---

## Task 4: Step 3 Template Selector Data Flow

**Files:**

- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`

- [ ] **Step 1: Add local template types**

Near the top of Step 3, add:

```ts
type WizardTemplateOption = {
  id: string;
  name: string;
  isDefault: boolean;
  blueprintTitle: string;
  printProviderTitle: string;
  enabledVariantIds: number[];
  enabledSizes: string[];
  defaultPlacement: unknown | null;
  readiness: {
    ready: boolean;
    missing: string[];
    label: "DEFAULT" | "DEFAULT INCOMPLETE" | "READY" | "INCOMPLETE";
  };
  colors: Array<{
    id: string;
    name: string;
    hex: string;
    enabled: boolean;
    sortOrder: number;
  }>;
};
```

- [ ] **Step 2: Add template list state**

Add state:

```ts
  const [templates, setTemplates] = useState<WizardTemplateOption[]>([]);
  const [templateWarning, setTemplateWarning] = useState("");
```

Replace the existing `template` state type usage with selected template from the list:

```ts
  const selectedTemplate = useMemo(() => {
    if (templates.length === 0) return null;
    return (
      templates.find((candidate) => candidate.id === draft?.templateId) ??
      templates.find((candidate) => candidate.isDefault) ??
      templates[0]
    );
  }, [templates, draft?.templateId]);
```

Use `selectedTemplate` where Step 3 currently uses `template`.

- [ ] **Step 3: Replace default-template fetch**

In the data-loading effect, replace:

```ts
fetch(`/api/stores/${draft.storeId}/template`).then(r => r.json()),
fetch(`/api/stores/${draft.storeId}/colors`).then(r => r.json()),
fetch(`/api/stores/${draft.storeId}/preset-status`).then(r => r.json())
```

with:

```ts
fetch(`/api/stores/${draft.storeId}/mockup-templates`).then((r) => r.json())
```

Then derive:

```ts
      const nextTemplates: WizardTemplateOption[] = Array.isArray(tData.templates)
        ? tData.templates
        : [];
      const activeTemplate =
        nextTemplates.find((candidate) => candidate.id === draft.templateId) ??
        nextTemplates.find((candidate) => candidate.isDefault) ??
        nextTemplates[0] ??
        null;

      setTemplates(nextTemplates);
      setTemplate(activeTemplate);
      setTemplateWarning("");

      const enabledColors = (activeTemplate?.colors ?? []).filter((color) => color.enabled !== false);
      setStoreColors(enabledColors);
      setPresetStatus(activeTemplate?.readiness ?? { ready: false, missing: ["template"] });
```

Keep `setTemplate` if the component still uses the old `template` state. If fully migrated to `selectedTemplate`, remove `setTemplate` and the old state after all references are replaced.

- [ ] **Step 4: Fetch sizes using selected template**

Change sizes fetch to:

```ts
        const sizeUrl = activeTemplate
          ? `/api/stores/${draft.storeId}/sizes?templateId=${activeTemplate.id}`
          : `/api/stores/${draft.storeId}/sizes`;
        fetch(sizeUrl)
```

Initialize selected sizes:

```ts
            const templateEnabledSizes: string[] =
              activeTemplate?.enabledSizes?.length
                ? activeTemplate.enabledSizes
                : sData.enabledSizes ?? sData.sizes?.map((s: any) => s.size) ?? [];
```

- [ ] **Step 5: Add template change handler**

Add:

```ts
  const handleTemplateChange = async (templateId: string) => {
    const nextTemplate = templates.find((candidate) => candidate.id === templateId);
    if (!nextTemplate) return;
    if (!nextTemplate.readiness.ready) {
      setTemplateWarning("Template nay chua san sang. Hay hoan tat preset truoc khi tao mockup.");
      return;
    }

    const nextColorIds = nextTemplate.colors
      .filter((color) => color.enabled !== false)
      .map((color) => color.id);
    const nextSizes = nextTemplate.enabledSizes ?? [];

    setTemplate(nextTemplate);
    setTemplateWarning("");
    setStoreColors(nextTemplate.colors.filter((color) => color.enabled !== false));
    setSelectedColorIds(new Set(nextColorIds));
    setSelectedSizes(new Set(nextSizes));
    setPlacementOverride(null);
    setPreviewColorIdx(0);
    setLivePreviewView("front");
    setMockupJobId(null);
    setMockupImages([]);
    setJobStatus(null);
    setJobProgress({ completed: 0, total: 0, failed: 0 });
    setGenerating(false);

    await updateDraft({
      templateId: nextTemplate.id,
      enabledColorIds: nextColorIds,
      enabledSizes: nextSizes,
      enabledVariantIdsOverride: [],
      placementOverride: null,
    });
    await saveDraftImmediately();
    setRetryNonce((value) => value + 1);
  };
```

- [ ] **Step 6: Add selector UI above left panels**

Inside the left column, before the colors panel, add a compact card:

```tsx
          <div className="card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ fontWeight: 600, fontSize: "0.95rem", margin: 0 }}>Mockup template</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.72rem", opacity: 0.55 }}>
                  Chon template cho listing hien tai
                </p>
              </div>
              {selectedTemplate && (
                <span className={selectedTemplate.readiness.ready ? "badge badge-success" : "badge badge-warning"}>
                  {selectedTemplate.readiness.label}
                </span>
              )}
            </div>

            {templates.length > 1 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {templates.map((candidate) => {
                  const active = selectedTemplate?.id === candidate.id;
                  const disabled = !candidate.readiness.ready;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => handleTemplateChange(candidate.id)}
                      disabled={disabled}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: active ? "1px solid var(--color-wise-green)" : "1px solid var(--border-default)",
                        backgroundColor: active ? "rgba(146, 198, 72, 0.06)" : "transparent",
                        opacity: disabled ? 0.5 : 1,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span style={{ fontWeight: 800, fontSize: "0.82rem" }}>{candidate.name}</span>
                        <span style={{ fontSize: "0.65rem", fontWeight: 800, opacity: 0.65 }}>
                          {candidate.readiness.label}
                        </span>
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: "0.72rem", opacity: 0.6, lineHeight: 1.3 }}>
                        {candidate.blueprintTitle || "Chua co blueprint"} · {candidate.colors.length} mau · {candidate.enabledSizes.length} sizes
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : selectedTemplate ? (
              <div style={{ fontSize: "0.8rem", lineHeight: 1.4 }}>
                <strong>{selectedTemplate.name}</strong>
                <p style={{ margin: "4px 0 0", opacity: 0.6 }}>
                  {selectedTemplate.blueprintTitle || "Chua co blueprint"} · {selectedTemplate.colors.length} mau · {selectedTemplate.enabledSizes.length} sizes
                </p>
              </div>
            ) : (
              <p style={{ margin: 0, opacity: 0.6, fontSize: "0.8rem" }}>
                Store chua co template.
              </p>
            )}

            {templateWarning && (
              <p style={{ margin: "10px 0 0", color: "var(--color-warning)", fontSize: "0.75rem" }}>
                {templateWarning}
              </p>
            )}
          </div>
```

Keep copy concise in implementation; if using Vietnamese accents is consistent in the file, use Vietnamese accents.

- [ ] **Step 7: Update generate disabled condition**

Change generate button readiness from `presetStatus?.ready` to selected template readiness:

```ts
  const selectedTemplateReady = Boolean(selectedTemplate?.readiness.ready);
```

Use `selectedTemplateReady` in `className`, `disabled`, and style conditions.

- [ ] **Step 8: Run TypeScript check through build or targeted tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/wizard/state.test.ts src/app/api/stores/[id]/mockup-templates/route.test.ts
```

Expected: pass.

Run:

```bash
npm run build
```

Expected: may fail on unrelated existing `scripts/simulate-printify-publish.ts` template/templates issue. If it fails there only, record it as unrelated.

---

## Task 5: Mockup Generation Server Validation

**Files:**

- Modify: `src/app/api/mockup-jobs/route.ts`

- [ ] **Step 1: Import readiness helper**

Add:

```ts
import { getTemplateReadiness, formatTemplateMissing } from "@/lib/stores/template-readiness";
```

- [ ] **Step 2: Include template colors**

Change draft include from:

```ts
      template: true,
```

to:

```ts
      template: {
        include: {
          colors: {
            include: { color: true },
          },
        },
      },
```

Change fallback template query from:

```ts
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
    });
```

to:

```ts
    template = await prisma.storeMockupTemplate.findFirst({
      where: { storeId: draft.storeId, isDefault: true },
      include: {
        colors: {
          include: { color: true },
        },
      },
    });
```

- [ ] **Step 3: Add readiness check**

After `if (!template)`, add:

```ts
  const readiness = getTemplateReadiness(template);
  if (!readiness.ready) {
    return NextResponse.json(
      {
        error: `Template chua san sang. Con thieu: ${formatTemplateMissing(readiness.missing)}.`,
        code: "TEMPLATE_NOT_READY",
      },
      { status: 400 },
    );
  }
```

- [ ] **Step 4: Validate selected colors belong to selected template**

After the `enabledColorIds` empty check, add:

```ts
  const templateColorIds = new Set(template.colors.map((entry) => entry.colorId));
  const invalidColorIds = draft.enabledColorIds.filter((colorId) => !templateColorIds.has(colorId));
  if (invalidColorIds.length > 0) {
    return NextResponse.json(
      {
        error: "Mot hoac nhieu mau da chon khong thuoc template hien tai. Hay chon lai template/mau.",
        code: "COLOR_NOT_IN_TEMPLATE",
      },
      { status: 400 },
    );
  }
```

- [ ] **Step 5: Run affected tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/stores/template-readiness.test.ts src/lib/wizard/state.test.ts
```

Expected: pass.

---

## Task 6: Mockup Job Timeout Helper and API Stall Guard

**Files:**

- Create: `src/lib/mockup/job-timeout.ts`
- Create: `src/lib/mockup/job-timeout.test.ts`
- Modify: `src/app/api/mockup-jobs/[id]/route.ts`

- [ ] **Step 1: Write timeout helper tests**

Create `src/lib/mockup/job-timeout.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  MOCKUP_JOB_STALL_MS,
  shouldFailStalledMockupJob,
} from "./job-timeout";

test("shouldFailStalledMockupJob returns false for completed jobs", () => {
  assert.equal(
    shouldFailStalledMockupJob({
      status: "completed",
      totalImages: 0,
      createdAt: new Date(Date.now() - MOCKUP_JOB_STALL_MS - 1),
      now: new Date(),
    }),
    false,
  );
});

test("shouldFailStalledMockupJob returns false before stall threshold", () => {
  const now = new Date("2026-05-21T00:10:00.000Z");
  assert.equal(
    shouldFailStalledMockupJob({
      status: "running",
      totalImages: 0,
      createdAt: new Date(now.getTime() - MOCKUP_JOB_STALL_MS + 1_000),
      now,
    }),
    false,
  );
});

test("shouldFailStalledMockupJob returns true for old running job with no images", () => {
  const now = new Date("2026-05-21T00:10:00.000Z");
  assert.equal(
    shouldFailStalledMockupJob({
      status: "running",
      totalImages: 0,
      createdAt: new Date(now.getTime() - MOCKUP_JOB_STALL_MS - 1_000),
      now,
    }),
    true,
  );
});

test("shouldFailStalledMockupJob returns false when total images exist", () => {
  const now = new Date("2026-05-21T00:10:00.000Z");
  assert.equal(
    shouldFailStalledMockupJob({
      status: "running",
      totalImages: 2,
      createdAt: new Date(now.getTime() - MOCKUP_JOB_STALL_MS - 1_000),
      now,
    }),
    false,
  );
});
```

- [ ] **Step 2: Run timeout tests and confirm failure**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/job-timeout.test.ts
```

Expected: fails because helper file does not exist.

- [ ] **Step 3: Implement timeout helper**

Create `src/lib/mockup/job-timeout.ts`:

```ts
import { isTerminalMockupJobStatus } from "./job-sync";

export const MOCKUP_JOB_SOFT_WAIT_MS = 120_000;
export const MOCKUP_JOB_STALL_MS = 360_000;

export const MOCKUP_JOB_STALL_MESSAGE =
  "Printify mockup job did not produce images in time. Worker may be offline or Printify may be delayed. Please retry.";

export function shouldFailStalledMockupJob(input: {
  status: string;
  totalImages: number;
  createdAt: Date;
  now?: Date;
}): boolean {
  if (isTerminalMockupJobStatus(input.status)) return false;
  if (!["pending", "running", "PENDING", "RUNNING"].includes(input.status)) return false;
  if (input.totalImages > 0) return false;

  const now = input.now ?? new Date();
  return now.getTime() - input.createdAt.getTime() > MOCKUP_JOB_STALL_MS;
}
```

- [ ] **Step 4: Add stall guard to GET route**

In `src/app/api/mockup-jobs/[id]/route.ts`, import:

```ts
import {
  MOCKUP_JOB_STALL_MESSAGE,
  shouldFailStalledMockupJob,
} from "@/lib/mockup/job-timeout";
```

After `if (!job)`, add:

```ts
  if (
    shouldFailStalledMockupJob({
      status: job.status,
      totalImages: job.totalImages,
      createdAt: job.createdAt,
    })
  ) {
    await prisma.mockupJob.update({
      where: { id },
      data: {
        status: "failed",
        errorMessage: MOCKUP_JOB_STALL_MESSAGE,
      },
    });
    job.status = "failed";
    job.errorMessage = MOCKUP_JOB_STALL_MESSAGE;
  }
```

- [ ] **Step 5: Run timeout tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/job-timeout.test.ts
```

Expected: pass.

---

## Task 7: Step 3 Soft No-Progress Warning

**Files:**

- Modify: `src/app/(authed)/wizard/[draftId]/step-3/page.tsx`

- [ ] **Step 1: Import soft wait constant**

Add:

```ts
import { MOCKUP_JOB_SOFT_WAIT_MS } from "@/lib/mockup/job-timeout";
```

- [ ] **Step 2: Add generation start timestamp state**

Add:

```ts
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [showSlowMockupWarning, setShowSlowMockupWarning] = useState(false);
```

- [ ] **Step 3: Set timestamp on generate**

In `handleGenerate`, after setting progress:

```ts
    setGenerationStartedAt(Date.now());
    setShowSlowMockupWarning(false);
```

When generation ends or fails, set:

```ts
          setGenerationStartedAt(null);
          setShowSlowMockupWarning(false);
```

- [ ] **Step 4: Add soft wait effect**

Add:

```ts
  useEffect(() => {
    if (!isGenerating || !generationStartedAt || jobProgress.total > 0) {
      setShowSlowMockupWarning(false);
      return;
    }

    const remaining = MOCKUP_JOB_SOFT_WAIT_MS - (Date.now() - generationStartedAt);
    if (remaining <= 0) {
      setShowSlowMockupWarning(true);
      return;
    }

    const timeout = setTimeout(() => setShowSlowMockupWarning(true), remaining);
    return () => clearTimeout(timeout);
  }, [generationStartedAt, isGenerating, jobProgress.total]);
```

- [ ] **Step 5: Render warning under generate header**

Below the generate button header and before stale mockup banner:

```tsx
            {showSlowMockupWarning && isGenerating && jobProgress.total === 0 && (
              <div
                className="alert"
                style={{
                  marginBottom: 12,
                  backgroundColor: "rgba(234, 179, 8, 0.06)",
                  border: "1px solid rgba(234, 179, 8, 0.25)",
                }}
              >
                <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} />
                <span style={{ fontSize: "0.82rem" }}>
                  Printify dang render lau hon binh thuong. He thong van dang kiem tra va se hien loi neu job bi ket.
                </span>
              </div>
            )}
```

Use Vietnamese accents if consistent with the surrounding file.

- [ ] **Step 6: Ensure failed job clears timestamps**

In polling branch where `job.status === "failed"`, ensure:

```ts
            setGenerationStartedAt(null);
            setShowSlowMockupWarning(false);
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/mockup/job-timeout.test.ts src/lib/wizard/state.test.ts
```

Expected: pass.

---

## Task 8: Full Verification

**Files:**

- No new files unless fixing issues found during verification.

- [ ] **Step 1: Run all new/affected tests**

Run:

```bash
./node_modules/.bin/tsx --test \
  src/lib/queue/workers/start-worker-source.test.ts \
  src/app/api/stores/[id]/mockup-templates/route.test.ts \
  src/lib/mockup/job-timeout.test.ts \
  src/lib/wizard/state.test.ts \
  src/lib/stores/template-readiness.test.ts \
  src/lib/stores/store-service-default.test.ts
```

Expected: pass.

- [ ] **Step 2: Run existing placement tests**

Run:

```bash
./node_modules/.bin/tsx --test src/lib/placement/views.test.ts src/lib/placement/schema.test.ts
```

Expected: pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: either pass, or fail only on the known unrelated `scripts/simulate-printify-publish.ts` `template`/`templates` issue. If it fails elsewhere, fix the new issue before reporting complete.

- [ ] **Step 4: PM2 manual verification command**

On the server or local PM2 environment, run:

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs mockupai-worker --lines 80
```

Expected:

- `mockupai` is online.
- `mockupai-worker` is online.
- Worker logs include:
  - `Mockup composite worker is ready`
  - `Printify mockup poll worker is ready`
  - `Triple Whale sync worker is ready`

- [ ] **Step 5: Manual Wizard verification**

Use a store with at least two templates:

1. Open an existing draft at Step 3.
2. Confirm the `Mockup template` selector appears.
3. Switch to a ready non-default template.
4. Confirm colors, sizes, and placement preview change.
5. Confirm the draft persists after refresh.
6. Click `Tao Mockups`.
7. Confirm job completes or fails with an actionable message.
8. Confirm UI does not spin forever at `0/...`.

- [ ] **Step 6: Final diff review**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` passes.
- No commit is made.
- Only files in this plan and previously approved uncommitted files are modified.

---

## Rollback Notes

Because no commit is made, rollback should be file-scoped:

- Revert `ecosystem.config.js` and `start-worker.ts` to remove dedicated worker changes.
- Revert Step 3 selector changes to return to default-template-only behavior.
- Keep `job-timeout.ts` only if API route still imports it; otherwise remove both helper and test.

Do not use `git reset --hard` because this worktree already contains unrelated uncommitted changes from earlier approved work.
