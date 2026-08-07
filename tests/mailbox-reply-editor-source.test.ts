import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/mailboxes/ReplyRichTextEditor.tsx", "utf8");

describe("Reply rich-text editor source contract", () => {
  it("uses client-only Tiptap initialization safe for Next SSR", () => {
    expect(source).toContain('"use client"');
    expect(source).toContain("useEditor");
    expect(source).toContain("immediatelyRender: false");
    expect(source).toContain("StarterKit");
  });

  it("exposes the approved Gmail-like toolbar controls", () => {
    for (const label of [
      "Font family", "Font size", "Bold", "Italic", "Underline", "Text color",
      "Align left", "Align center", "Align right", "Bulleted list", "Numbered list",
      "Quote", "Indent", "Outdent", "Insert link", "Emoji", "Undo", "Redo", "Clear formatting",
    ]) {
      expect(source).toContain(label);
    }
  });

  it("emits HTML and plain text and preserves selection on toolbar click", () => {
    expect(source).toContain("editor.getHTML()");
    expect(source).toContain("editor.getText");
    expect(source).toContain("preventDefault()");
    expect(source).toContain("onChange");
  });

  it("provides an accessible empty state and keyboard-visible focus", () => {
    expect(source).toContain("@tiptap/extension-placeholder");
    expect(source).toContain("Placeholder.configure");
    expect(source).toContain('placeholder: "Write your reply..."');
    expect(source).toContain("aria-pressed={active === undefined ? undefined : active}");
    expect(source).toContain('"aria-label": "Reply body"');
    expect(source).toContain(":focus-visible");
  });

  it("clears block-level formatting and uses readable color labels", () => {
    expect(source).toContain("unsetTextAlign");
    expect(source).toContain('updateAttributes("paragraph", { marginLeft: null })');
    expect(source).toContain('name: "Red"');
    expect(source).not.toContain("window.prompt");
    expect(source).toContain("Apply link");
  });
});
