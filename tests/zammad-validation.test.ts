/**
 * Unit tests for Zammad validation module.
 */
import { describe, it, expect } from "vitest";
import { validateReplyBody, validateStatusBody } from "../src/lib/zammad/validation";

// ──────────────────────── validateReplyBody ────────────────────────

describe("validateReplyBody", () => {
  it("accepts valid text", () => {
    const result = validateReplyBody({ text: "Hello, please help!" });
    expect(result).toEqual({ valid: true, text: "Hello, please help!" });
  });

  it("trims whitespace", () => {
    const result = validateReplyBody({ text: "  hello  " });
    expect(result).toEqual({ valid: true, text: "hello" });
  });

  it("accepts text containing < and > characters (not HTML rejection)", () => {
    // Email replies may contain these characters — spec says treat as plain text
    const result = validateReplyBody({ text: "Price is < $100 and > $50" });
    expect(result).toEqual({ valid: true, text: "Price is < $100 and > $50" });
  });

  it("accepts text containing HTML-like tags (plain text treatment)", () => {
    const result = validateReplyBody({ text: "Please use <b>bold</b> tags" });
    expect(result).toEqual({ valid: true, text: "Please use <b>bold</b> tags" });
  });

  it("rejects empty body", () => {
    expect(validateReplyBody(null)).toEqual({ valid: false, error: "Request body is required" });
    expect(validateReplyBody(undefined)).toEqual({ valid: false, error: "Request body is required" });
  });

  it("rejects missing text field", () => {
    const result = validateReplyBody({});
    expect(result).toEqual({ valid: false, error: "\"text\" must be a string" });
  });

  it("rejects non-string text", () => {
    const result = validateReplyBody({ text: 123 });
    expect(result).toEqual({ valid: false, error: "\"text\" must be a string" });
  });

  it("rejects empty text after trim", () => {
    const result = validateReplyBody({ text: "   " });
    expect(result).toEqual({ valid: false, error: "Reply text must not be empty" });
  });

  it("rejects text exceeding 50,000 chars", () => {
    const result = validateReplyBody({ text: "a".repeat(50_001) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("50000");
    }
  });

  it("accepts text at exactly 50,000 chars", () => {
    const result = validateReplyBody({ text: "a".repeat(50_000) });
    expect(result.valid).toBe(true);
  });

  it("rejects extra fields", () => {
    const result = validateReplyBody({ text: "hello", html: "<b>hello</b>" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Extra fields");
      expect(result.error).toContain("html");
    }
  });

  it("rejects body with only extra fields", () => {
    const result = validateReplyBody({ body: "hello" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Extra fields");
    }
  });
});

// ──────────────────────── validateStatusBody ────────────────────────

describe("validateStatusBody", () => {
  it("accepts 'active'", () => {
    expect(validateStatusBody({ status: "active" })).toEqual({ valid: true, status: "active" });
  });

  it("accepts 'pending'", () => {
    expect(validateStatusBody({ status: "pending" })).toEqual({ valid: true, status: "pending" });
  });

  it("accepts 'closed'", () => {
    expect(validateStatusBody({ status: "closed" })).toEqual({ valid: true, status: "closed" });
  });

  it("rejects invalid status", () => {
    const result = validateStatusBody({ status: "spam" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("spam");
      expect(result.error).toContain("Allowed");
    }
  });

  it("rejects missing status", () => {
    expect(validateStatusBody({})).toEqual({ valid: false, error: "\"status\" must be a string" });
  });

  it("rejects non-string status", () => {
    expect(validateStatusBody({ status: 1 })).toEqual({ valid: false, error: "\"status\" must be a string" });
  });

  it("rejects extra fields", () => {
    const result = validateStatusBody({ status: "active", reason: "test" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Extra fields");
    }
  });

  it("rejects empty body", () => {
    expect(validateStatusBody(null)).toEqual({ valid: false, error: "Request body is required" });
  });
});
