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

# [app] recent context, 2026-06-26 7:27am GMT+7

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 19 obs (7,432t read) | 32,016t work | 77% savings

### Jun 25, 2026
1829 10:42p 🔵 ERR_REQUIRE_ESM Error in @prisma/dev When Running npx prisma generate
1830 10:43p 🔵 Prisma Generate Crashes with Internal State Module Dump
1831 10:44p 🔵 Prisma Generate Produces Unexpected Raw Module Output in vietminhglobal App
S233 Fix `npx prisma generate` failure in pnpm-based vietminhglobal app (Jun 25 at 10:44 PM)
1832 10:48p 🔵 Prisma Generate Failing in vietminhglobal App
1833 " 🔵 Root Cause of Prisma Generate Failure: ESM/CJS Incompatibility with zeptomatch
1834 10:49p 🔵 npx prisma generate outputs raw @prisma/dev internals in vietminhglobal app
1835 10:50p 🔵 Prisma Generate Dumps Raw @prisma/dev State Module Source
1836 " 🔵 Prisma Generate Failure in vietminhglobal App
1837 " 🔵 zeptomatch is ESM-only, Causing CJS Require Failure in @prisma/dev
1838 10:52p 🔵 Prisma Generate Fails with @prisma/dev Internal Module Error
1839 10:53p 🔵 pnpm Dependency Issue — Investigating Lock File and node_modules
1840 10:55p 🔵 Prisma Generate Crashes with Internal Module Source Dump
1841 " ✅ Vietminhglobal App Dependencies Reinstalled with --ignore-scripts
1842 10:57p 🔵 Prisma Generate Outputs Raw Module Source — Possible Version/Node Compatibility Issue
1843 " 🔵 Prisma v7 `ERR_REQUIRE_ESM` Bug — `@prisma/dev` Cannot `require()` ESM-only `zeptomatch`
1844 11:00p 🔵 Prisma Generate Invoked in vietminhglobal Project
1845 11:01p 🔵 Prisma Generate Exposes @prisma/dev Internal State Module Error
1846 11:02p 🔵 npx prisma generate Outputs Raw Minified Source Instead of Running
1847 11:05p 🔵 Prisma Generate Failure in vietminhglobal App
S234 Fix Prisma v7 `npx prisma generate` crash in vietminhglobal app — ESM/CJS compatibility bug with zeptomatch (Jun 25 at 11:06 PM)
**Investigated**: The crash output from `npx prisma generate` was traced to `@prisma/dev/dist/state.cjs` attempting to `require("zeptomatch")`, which fails because `zeptomatch` is an ESM-only package and cannot be required from a CommonJS module. This is a known upstream bug: prisma/prisma#28784, with no official fix yet.

**Learned**: Prisma v7's `@prisma/dev` package is distributed as CJS but depends on `zeptomatch`, which is ESM-only. The `@prisma/dev` state.cjs module handles local dev server lifecycle (port allocation, PID management, lockfiles) and is invoked during `prisma generate`. This ESM/CJS mismatch causes the entire generate command to crash with a raw module dump instead of a useful error message.

**Completed**: - Created a CJS shim for `zeptomatch` at `patches/zeptomatch-shim.cjs` that implements the `zeptomatch(glob, path)` interface in CommonJS
    - Used `pnpm patch` to apply fixes to 4 files inside `@prisma/dev`, patching the require call to use the shim
    - Generated `patches/@prisma__dev@0.24.3.patch` (auto-generated by pnpm patch workflow)
    - Added `patchedDependencies` entry to `package.json` so `pnpm install` auto-applies the patch on any future install (e.g., on VPS pull)
    - Confirmed `pnpm prisma generate` now runs successfully

**Next Steps**: Commit the three changed/added files to version control: `patches/@prisma__dev@0.24.3.patch`, `patches/zeptomatch-shim.cjs`, and `package.json`. After committing and pushing, a `pnpm install` on the VPS will automatically apply the patch with no further manual steps.


Access 32k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>