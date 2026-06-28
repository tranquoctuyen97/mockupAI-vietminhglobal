import { describe, expect, it } from "vitest";
import { decodeRtAttachmentContent, enrichThreadsForDisplay } from "./thread-display";
import type { NormalizedThread, RtAttachmentDetail } from "./types";

describe("thread display enrichment", () => {
  it("decodes RT attachment content and prefers html bodies over plain text content", () => {
    const threads: NormalizedThread[] = [
      {
        id: 215,
        conversationId: 26,
        subject: "ChatGPT - Kế hoạch của bạn sẽ không được làm mới",
        body: "plain fallback",
        contentType: "text/plain",
        from: "",
        to: "",
        cc: "",
        type: "create",
        sender: "support@openai.com",
        internal: false,
        attachments: [],
        createdAt: "2026-06-27T16:29:00.000Z",
      },
    ];
    const html = "<!doctype html><html><body><h1>OpenAI</h1></body></html>";
    const attachments: RtAttachmentDetail[] = [
      {
        id: 66,
        TransactionId: { id: "215" },
        ContentType: "text/html",
        Content: Buffer.from(html, "utf8").toString("base64"),
      },
    ];

    const enriched = enrichThreadsForDisplay({
      threads,
      attachments,
      mailboxEmail: "anhiri66@gmail.com",
      customerEmail: "support@openai.com",
    });

    expect(decodeRtAttachmentContent(Buffer.from(html, "utf8").toString("base64"))).toBe(html);
    expect(enriched[0].body).toBe(html);
    expect(enriched[0].contentType).toBe("text/html");
    expect(enriched[0].hidden).toBe(false);
  });

  it("hides RT system noise and converts recorded app replies into visible outbound messages", () => {
    const threads: NormalizedThread[] = [
      {
        id: 216,
        conversationId: 26,
        subject: undefined,
        body: "",
        contentType: "text/plain",
        from: "",
        to: "",
        cc: "",
        type: "systemerror",
        sender: "RT_System",
        internal: false,
        attachments: [],
        createdAt: "2026-06-27T16:29:01.000Z",
      },
      {
        id: 300,
        conversationId: 26,
        subject: undefined,
        body: [
          "App-sent Gmail reply recorded.",
          "Gmail-Message-ID: <abc@example.com>",
          "Gmail-Thread-ID: 123",
          "",
          "Thanks for the update.",
        ].join("\n"),
        contentType: "text/plain",
        from: "",
        to: "",
        cc: "",
        type: "comment",
        sender: "RT_System",
        internal: true,
        attachments: [],
        createdAt: "2026-06-27T16:35:00.000Z",
      },
    ];

    const enriched = enrichThreadsForDisplay({
      threads,
      attachments: [],
      mailboxEmail: "anhiri66@gmail.com",
      customerEmail: "support@openai.com",
      fallbackSubject: "Original subject",
    });

    expect(enriched[0].hidden).toBe(true);
    expect(enriched[1].hidden).toBe(false);
    expect(enriched[1].displayType).toBe("app_reply");
    expect(enriched[1].from).toBe("anhiri66@gmail.com");
    expect(enriched[1].to).toBe("support@openai.com");
    expect(enriched[1].body).toBe("Thanks for the update.");
    expect(enriched[1].subject).toBe("Original subject");
  });
});
