import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/mailbox-proxy/[...path]/route.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const validation = readFileSync("src/lib/mailboxes/validation.ts", "utf8");

describe("mailbox composer feature source contract", () => {
  it("persists internal notes and exposes a conversation scoped route", () => {
    expect(schema).toContain("model MailboxInternalNote");
    expect(route).toContain("/internal-notes");
    expect(route).toContain("handleCreateInternalNote");
    expect(route).toContain("mailboxInternalNote.create");
    expect(route).toContain('displayType: "internal"');
    expect(validation).toContain("internalNoteSchema");
  });

  it("stores composer attachments and sends them with Gmail replies", () => {
    expect(schema).toContain("model MailboxComposerAttachment");
    expect(route).toContain("/attachments");
    expect(route).toContain("handleUploadComposerAttachment");
    expect(route).toContain("getStorage().putBuffer");
    expect(route).toContain("attachmentIds");
    expect(route).toContain("attachments: attachmentPayload.length ? attachmentPayload : undefined");
    expect(route).toContain('state: "SENT"');
  });
});
