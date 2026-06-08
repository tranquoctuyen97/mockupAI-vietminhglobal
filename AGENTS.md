<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Coding Standards — TypeScript / Next.js

### Imports: ALWAYS top-level static `import`

**NEVER use dynamic `await import()` or `import()` inside functions/methods** unless one of these exceptions applies:

1. **`instrumentation.ts`** — Next.js requires dynamic import to avoid side-effects during build phase
2. **`React.lazy()` / `next/dynamic`** — code-splitting client components (the only valid frontend use)
3. **Conditional platform imports** — e.g. loading a module only when `process.env.NEXT_RUNTIME === "nodejs"` in a file that may also run on edge

If none of these exceptions apply, put the import at the **top of the file** as a normal `import` statement.

#### ❌ WRONG — dynamic import in function body
```typescript
async function doWork(storeId: string) {
  const { getClientForStore } = await import("@/lib/printify/account");
  const result = await getClientForStore(storeId);
}
```

#### ✅ CORRECT — static import at top of file
```typescript
import { getClientForStore } from "@/lib/printify/account";

async function doWork(storeId: string) {
  const result = await getClientForStore(storeId);
}
```

#### ❌ WRONG — importing a symbol that's already imported at the top
```typescript
import { readFile, mkdir } from "node:fs/promises";
// ... 200 lines later ...
async function writeData(path: string, data: Buffer) {
  const { writeFile } = await import("node:fs/promises"); // ← BUG: just add writeFile to line 1
  await writeFile(path, data);
}
```

### Why this matters
- Dynamic imports bypass tree-shaking, making bundles larger
- Dependencies hidden in function bodies are invisible when reading a file's header
- Each dynamic import adds a module resolution overhead (even if Node caches it)
- Duplicating an already-imported module via dynamic import is a clear bug

### Other import rules
- Group imports: Node builtins → external packages → `@/` aliases → relative paths
- Never duplicate an import — if a module is imported at the top, use that binding everywhere in the file
- For Node.js builtins, prefer `node:` prefix: `import { readFile } from "node:fs/promises"` (not `"fs/promises"`)

<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37777
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>