"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Redo2,
  Smile,
  TextQuote,
  Underline,
  Undo2,
} from "lucide-react";
import { Extension } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import UnderlineExtension from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ReplyComposerValue } from "@/lib/mailboxes/reply-content";

const FONT_FAMILIES = [
  "Arial",
  "Georgia",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

const FONT_SIZES = ["10px", "12px", "16px", "24px"] as const;
const TEXT_COLORS = [
  { name: "Ink", value: "#111827" },
  { name: "Gray", value: "#4b5563" },
  { name: "Red", value: "#dc2626" },
  { name: "Orange", value: "#d97706" },
  { name: "Green", value: "#16a34a" },
  { name: "Blue", value: "#2563eb" },
  { name: "Purple", value: "#7c3aed" },
] as const;
const EMOJIS = ["🙂", "👍", "🎉", "❤️", "🙏", "✅", "🚀", "😊", "😂", "👏"] as const;
const INDENT_LEVELS = ["0px", "24px", "48px", "72px"] as const;
type IndentLevel = (typeof INDENT_LEVELS)[number];

const ReplyIndent = Extension.create({
  name: "replyIndent",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "blockquote", "listItem"],
        attributes: {
          marginLeft: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.style.marginLeft;
              return INDENT_LEVELS.includes(value as IndentLevel) ? value : null;
            },
            renderHTML: (attributes: { marginLeft?: string | null }) =>
              attributes.marginLeft ? { style: `margin-left: ${attributes.marginLeft}` } : {},
          },
        },
      },
    ];
  },
});

interface ReplyRichTextEditorProps {
  value: ReplyComposerValue;
  onChange: (value: ReplyComposerValue) => void;
  disabled?: boolean;
}

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onAction: () => void;
  children: ReactNode;
}

function ToolbarButton({ label, active, disabled, onAction, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? "true" : "false"}
      className="reply-rich-editor__tool"
      onMouseDown={(event) => {
        event.preventDefault();
        onAction();
      }}
    >
      {children}
    </button>
  );
}

export function ReplyRichTextEditor({ value, onChange, disabled = false }: ReplyRichTextEditorProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        link: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: "Write your reply..." }),
      TextStyle,
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize.configure({ types: ["textStyle"] }),
      Color.configure({ types: ["textStyle"] }),
      UnderlineExtension,
      TextAlign.configure({
        types: ["heading", "paragraph", "blockquote"],
        alignments: ["left", "center", "right"],
      }),
      Link.configure({
        autolink: false,
        openOnClick: false,
        HTMLAttributes: {
          target: "_blank",
          rel: "noopener noreferrer",
        },
        isAllowedUri: (url) => /^(?:https?:|mailto:)/i.test(url.trim()),
      }),
      ReplyIndent,
    ],
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: value.html || "<p></p>",
    editable: !disabled,
    editorProps: {
      attributes: {
        "aria-label": "Reply body",
        role: "textbox",
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current({
        html: editor.getHTML() === "<p></p>" ? "" : editor.getHTML(),
        text: editor.getText({ blockSeparator: "\n" }).trim(),
      });
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const nextContent = value.html || "<p></p>";
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [editor, value.html]);

  if (!editor) return null;

  const isDisabled = disabled || !editor.isEditable;
  const textStyleAttributes = editor.getAttributes("textStyle") as {
    fontFamily?: string;
    fontSize?: string;
    color?: string;
  };

  const runToolbarAction = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    event.preventDefault();
    action();
  };

  const changeIndent = (direction: 1 | -1) => {
    if (editor.isActive("bulletList") || editor.isActive("orderedList")) {
      if (direction === 1) editor.chain().focus().sinkListItem("listItem").run();
      else editor.chain().focus().liftListItem("listItem").run();
      return;
    }

    const current = editor.getAttributes("paragraph").marginLeft as IndentLevel | null;
    const currentIndex = Math.max(0, INDENT_LEVELS.indexOf(current ?? "0px"));
    const nextIndex = Math.min(INDENT_LEVELS.length - 1, Math.max(0, currentIndex + direction));
    const nextMarginLeft = nextIndex === 0 ? null : INDENT_LEVELS[nextIndex];
    editor.chain().focus().updateAttributes("paragraph", { marginLeft: nextMarginLeft }).run();
  };

  const openLinkEditor = () => {
    const currentHref = (editor.getAttributes("link") as { href?: string }).href ?? "";
    setLinkHref(currentHref);
    setLinkError("");
    setLinkOpen(true);
  };

  const applyLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedHref = linkHref.trim();
    if (!/^(?:https?:|mailto:)/i.test(normalizedHref)) {
      setLinkError("Use an https:// or mailto: link.");
      return;
    }
    editor
      .chain()
      .focus()
      .setLink({ href: normalizedHref, target: "_blank", rel: "noopener noreferrer" })
      .run();
    setLinkOpen(false);
    setLinkError("");
  };

  const clearFormatting = () => {
    editor
      .chain()
      .focus()
      .clearNodes()
      .unsetAllMarks()
      .unsetTextAlign()
      .updateAttributes("paragraph", { marginLeft: null })
      .updateAttributes("blockquote", { marginLeft: null })
      .updateAttributes("listItem", { marginLeft: null })
      .run();
  };

  return (
    <div className="reply-rich-editor">
      <div className="reply-rich-editor__toolbar" role="toolbar" aria-label="Reply formatting toolbar">
        <label className="reply-rich-editor__select-wrap">
          <span className="reply-rich-editor__sr-only">Font family</span>
          <select
            aria-label="Font family"
            value={textStyleAttributes.fontFamily ?? ""}
            disabled={isDisabled}
            onChange={(event) => {
              const command = editor.chain().focus();
              if (event.target.value) command.setFontFamily(event.target.value).run();
              else command.unsetFontFamily().run();
            }}
          >
            <option value="">Sans Serif</option>
            {FONT_FAMILIES.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>
        <label className="reply-rich-editor__select-wrap reply-rich-editor__select-wrap--small">
          <span className="reply-rich-editor__sr-only">Font size</span>
          <select
            aria-label="Font size"
            value={textStyleAttributes.fontSize ?? ""}
            disabled={isDisabled}
            onChange={(event) => {
              const command = editor.chain().focus();
              if (event.target.value) command.setFontSize(event.target.value).run();
              else command.unsetFontSize().run();
            }}
          >
            <option value="">Size</option>
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size.replace("px", "")}
              </option>
            ))}
          </select>
        </label>
        <div className="reply-rich-editor__separator" />
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive("underline")}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline size={16} />
        </ToolbarButton>
        <label className="reply-rich-editor__select-wrap reply-rich-editor__select-wrap--color">
          <Palette size={16} aria-hidden="true" />
          <span className="reply-rich-editor__sr-only">Text color</span>
          <select
            aria-label="Text color"
            value={textStyleAttributes.color ?? ""}
            disabled={isDisabled}
            onChange={(event) => {
              const command = editor.chain().focus();
              if (event.target.value) command.setColor(event.target.value).run();
              else command.unsetColor().run();
            }}
          >
            <option value="">Text color</option>
            {TEXT_COLORS.map((color) => (
              <option key={color.value} value={color.value}>
                {color.name}
              </option>
            ))}
          </select>
        </label>
        <div className="reply-rich-editor__separator" />
        <ToolbarButton
          label="Align left"
          active={editor.isActive({ textAlign: "left" })}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Align center"
          active={editor.isActive({ textAlign: "center" })}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Align right"
          active={editor.isActive({ textAlign: "right" })}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Bulleted list"
          active={editor.isActive("bulletList")}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={editor.isActive("blockquote")}
          disabled={isDisabled}
          onAction={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <TextQuote size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Indent"
          disabled={isDisabled}
          onAction={() => changeIndent(1)}
        >
          <IndentIncrease size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Outdent"
          disabled={isDisabled}
          onAction={() => changeIndent(-1)}
        >
          <IndentDecrease size={16} />
        </ToolbarButton>
        <div className="reply-rich-editor__link-wrap">
          <ToolbarButton label="Insert link" disabled={isDisabled} onAction={openLinkEditor}>
            <Link2 size={16} />
          </ToolbarButton>
          {linkOpen ? (
            <form className="reply-rich-editor__link-popover" aria-label="Link editor" onSubmit={applyLink}>
              <label htmlFor="reply-link-url">Link URL</label>
              <input
                id="reply-link-url"
                type="text"
                inputMode="url"
                autoFocus
                value={linkHref}
                placeholder="https://example.com"
                onChange={(event) => {
                  setLinkHref(event.target.value);
                  setLinkError("");
                }}
              />
              {linkError ? <span className="reply-rich-editor__link-error">{linkError}</span> : null}
              <div className="reply-rich-editor__link-actions">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setLinkOpen(false);
                  }}
                >
                  Cancel
                </button>
                {editor.isActive("link") ? (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      editor.chain().focus().unsetLink().run();
                      setLinkOpen(false);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
                <button type="submit">Apply link</button>
              </div>
            </form>
          ) : null}
        </div>
        <div className="reply-rich-editor__emoji-wrap">
          <ToolbarButton
            label="Emoji"
            disabled={isDisabled}
            onAction={() => setEmojiOpen((open) => !open)}
          >
            <Smile size={16} />
          </ToolbarButton>
          {emojiOpen ? (
            <div className="reply-rich-editor__emoji-menu" role="menu" aria-label="Emoji">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={`Insert ${emoji}`}
                  onMouseDown={(event) => {
                    runToolbarAction(event, () => {
                      editor.chain().focus().insertContent(emoji).run();
                      setEmojiOpen(false);
                    });
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="reply-rich-editor__separator" />
        <ToolbarButton
          label="Undo"
          disabled={isDisabled}
          onAction={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          disabled={isDisabled}
          onAction={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Clear formatting"
          disabled={isDisabled}
          onAction={clearFormatting}
        >
          <Eraser size={16} />
        </ToolbarButton>
      </div>
      <div className="reply-rich-editor__field">
        <EditorContent editor={editor} />
      </div>
      <style>{`
        .reply-rich-editor {
          border: 1px solid #d9dee8;
          border-radius: 12px;
          background: #fff;
          overflow: visible;
        }
        .reply-rich-editor__toolbar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 2px;
          padding: 7px 9px;
          border-bottom: 1px solid #e6e9ef;
          background: #f8f9fc;
        }
        .reply-rich-editor__tool,
        .reply-rich-editor__select-wrap select {
          height: 30px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: #4b5563;
          font: inherit;
        }
        .reply-rich-editor__tool {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 30px;
          padding: 0 7px;
          cursor: pointer;
          transition: background-color .15s ease, color .15s ease;
        }
        .reply-rich-editor__tool:hover,
        .reply-rich-editor__tool[data-active="true"] {
          background: #e5edff;
          color: #2458d3;
        }
        .reply-rich-editor__tool:disabled,
        .reply-rich-editor__select-wrap select:disabled {
          cursor: not-allowed;
          opacity: .45;
        }
        .reply-rich-editor__tool:focus-visible,
        .reply-rich-editor__select-wrap select:focus-visible,
        .reply-rich-editor__emoji-menu button:focus-visible,
        .reply-rich-editor__link-popover input:focus-visible,
        .reply-rich-editor__link-actions button:focus-visible,
        .reply-rich-editor .tiptap:focus-visible {
          outline: 2px solid #2458d3;
          outline-offset: 2px;
        }
        .reply-rich-editor__select-wrap {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 0 2px;
        }
        .reply-rich-editor__select-wrap select {
          max-width: 132px;
          padding: 0 5px;
          cursor: pointer;
        }
        .reply-rich-editor__select-wrap--small select {
          max-width: 62px;
        }
        .reply-rich-editor__select-wrap--color select {
          max-width: 92px;
        }
        .reply-rich-editor__separator {
          width: 1px;
          height: 22px;
          margin: 0 4px;
          background: #d9dee8;
        }
        .reply-rich-editor__emoji-wrap {
          position: relative;
        }
        .reply-rich-editor__link-wrap {
          position: relative;
        }
        .reply-rich-editor__link-popover {
          position: absolute;
          z-index: 5;
          top: 35px;
          left: 0;
          display: grid;
          gap: 7px;
          width: min(280px, calc(100vw - 32px));
          padding: 10px;
          border: 1px solid #d9dee8;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 8px 20px rgba(15, 23, 42, .14);
        }
        .reply-rich-editor__link-popover label {
          color: #344054;
          font-size: 12px;
          font-weight: 600;
        }
        .reply-rich-editor__link-popover input {
          min-width: 0;
          height: 32px;
          padding: 0 8px;
          border: 1px solid #cfd6e2;
          border-radius: 6px;
          color: #1f2937;
          font: inherit;
        }
        .reply-rich-editor__link-error {
          color: #b42318;
          font-size: 12px;
        }
        .reply-rich-editor__link-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }
        .reply-rich-editor__link-actions button {
          min-height: 30px;
          padding: 0 9px;
          border: 1px solid #cfd6e2;
          border-radius: 6px;
          background: #fff;
          color: #344054;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
        }
        .reply-rich-editor__link-actions button[type="submit"] {
          border-color: #2458d3;
          background: #2458d3;
          color: #fff;
        }
        .reply-rich-editor__emoji-menu {
          position: absolute;
          z-index: 4;
          top: 35px;
          left: 0;
          display: grid;
          grid-template-columns: repeat(5, 32px);
          gap: 3px;
          padding: 7px;
          border: 1px solid #d9dee8;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 8px 20px rgba(15, 23, 42, .14);
        }
        .reply-rich-editor__emoji-menu button {
          border: 0;
          border-radius: 5px;
          background: transparent;
          font-size: 18px;
          line-height: 28px;
          cursor: pointer;
        }
        .reply-rich-editor__emoji-menu button:hover {
          background: #eef2ff;
        }
        .reply-rich-editor__field {
          min-height: 150px;
          padding: 12px 14px;
        }
        .reply-rich-editor .tiptap {
          min-height: 125px;
          outline: none;
          color: #1f2937;
          font-size: 14px;
          line-height: 1.55;
        }
        .reply-rich-editor .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          color: #98a2b3;
          pointer-events: none;
        }
        .reply-rich-editor .tiptap p {
          margin: 0 0 8px;
        }
        .reply-rich-editor .tiptap p:last-child {
          margin-bottom: 0;
        }
        .reply-rich-editor .tiptap ul,
        .reply-rich-editor .tiptap ol {
          margin: 0 0 8px;
          padding-left: 24px;
        }
        .reply-rich-editor .tiptap blockquote {
          margin: 8px 0;
          padding-left: 12px;
          border-left: 3px solid #c7d2fe;
          color: #4b5563;
        }
        .reply-rich-editor .tiptap a {
          color: #2458d3;
          text-decoration: underline;
        }
        .reply-rich-editor__sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        @media (max-width: 640px) {
          .reply-rich-editor__toolbar {
            gap: 4px;
            padding: 6px;
          }
          .reply-rich-editor__tool {
            min-width: 32px;
          }
          .reply-rich-editor__select-wrap select {
            max-width: 108px;
          }
          .reply-rich-editor__select-wrap--small select {
            max-width: 58px;
          }
          .reply-rich-editor__select-wrap--color select {
            max-width: 84px;
          }
          .reply-rich-editor .tiptap {
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  );
}
