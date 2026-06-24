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
});
