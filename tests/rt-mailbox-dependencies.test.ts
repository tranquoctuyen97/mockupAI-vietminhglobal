import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RT Gmail mailbox dependencies", () => {
  it("pins Gmail IMAP and SMTP clients", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.imapflow).toBe("1.4.2");
    expect(pkg.dependencies?.nodemailer).toBe("9.0.1");
    expect(pkg.devDependencies?.["@types/nodemailer"]).toBe("8.0.1");
  });

  it("keeps npm and pnpm lockfiles on the exact ImapFlow version", () => {
    const npmLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };
    const pnpmLock = readFileSync("pnpm-lock.yaml", "utf8");

    expect(npmLock.packages?.["node_modules/imapflow"]?.version).toBe("1.4.2");
    expect(pnpmLock).toContain("imapflow@1.4.2:");
    expect(pnpmLock).not.toMatch(/imapflow@(?!1\.4\.2:)[^\s]+:/);
  });
});
