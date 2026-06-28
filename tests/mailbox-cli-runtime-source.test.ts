import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("mailbox CLI runtime compatibility", () => {
  for (const relativePath of ["scripts/mailbox-secret-helper.ts", "scripts/verified-rt-mailgate.ts"]) {
    it(`${relativePath} avoids top-level await for the Node 22 worker image`, () => {
      const source = readFileSync(join(root, relativePath), "utf8");
      expect(source).not.toMatch(/if\s*\([^)]*import\.meta[\s\S]{0,200}process\.exitCode\s*=\s*await\b/);
      expect(source).toMatch(/void\s+runCli\(\)/);
    });
  }
});
