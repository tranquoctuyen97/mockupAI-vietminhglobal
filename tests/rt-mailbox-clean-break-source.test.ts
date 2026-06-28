import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [".env.example", "src", "tests", "scripts", "infra", "prisma", "docs"];
const IGNORED_DIRS = new Set([".git", ".next", "node_modules"]);
const IGNORED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const ALLOWED_HISTORICAL_DOCS = new Set([
  "docs/superpowers/specs/2026-06-24-rt-getmail-gmail-labels-design.md",
  "docs/superpowers/plans/2026-06-24-rt-getmail-gmail-labels.md",
]);

const forbiddenBackendName = ["zam", "mad"].join("");
const forbiddenEnvPrefix = ["ZAM", "MAD_"].join("");

function collectFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) return [];
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? collectFiles(child) : [child];
  });
}

describe("RT Gmail mailbox clean break", () => {
  it("contains the replacement runtime entrypoints", () => {
    expect(existsSync("src/lib/rt/client.ts")).toBe(true);
    expect(existsSync("src/lib/mailboxes/gmail-client.ts")).toBe(true);
    expect(existsSync("infra/rt/docker-compose.yml")).toBe(true);
  });

  it("contains no active references to the replaced backend", () => {
    const forbiddenMatches: string[] = [];

    for (const root of ROOTS) {
      for (const absolutePath of collectFiles(resolve(root))) {
        const path = relative(process.cwd(), absolutePath);
        if (IGNORED_FILES.has(path) || ALLOWED_HISTORICAL_DOCS.has(path)) continue;

        let source: string;
        try {
          source = readFileSync(absolutePath, "utf8");
        } catch {
          continue;
        }

        source.split(/\r?\n/).forEach((line, index) => {
          if (
            line.toLowerCase().includes(forbiddenBackendName) ||
            line.includes(forbiddenEnvPrefix)
          ) {
            forbiddenMatches.push(`${path}:${index + 1}`);
          }
        });
      }
    }

    expect(forbiddenMatches).toEqual([]);
  });
});
