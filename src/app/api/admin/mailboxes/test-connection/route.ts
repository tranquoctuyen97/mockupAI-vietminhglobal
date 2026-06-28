import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";
import { verifyGmailSmtp } from "@/lib/mailboxes/gmail-smtp";
import { testMailboxConnectionSchema } from "@/lib/mailboxes/validation";

function cleanAppPassword(value: string): string {
  return value.replace(/\s/g, "");
}

export async function POST(request: Request) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = testMailboxConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const credentials = {
    email: parsed.data.email,
    appPassword: cleanAppPassword(parsed.data.password),
  };

  const smtp = await verifyGmailSmtp(credentials);
  if (!smtp.ok) {
    return NextResponse.json({
      result: "failed",
      message:
        smtp.error === "gmail_auth_failed"
          ? "Gmail authentication failed"
          : "Gmail SMTP unavailable",
      message_human:
        smtp.error === "gmail_auth_failed"
          ? "Gmail từ chối đăng nhập. Kiểm tra email và App Password."
          : "Không thể kết nối Gmail SMTP. Vui lòng thử lại sau.",
    });
  }

  try {
    await createGmailAdapter(credentials).probe();
  } catch {
    return NextResponse.json({
      result: "failed",
      message: "Gmail IMAP unavailable",
      message_human: "Không thể kết nối Gmail IMAP. Kiểm tra IMAP và App Password.",
    });
  }

  return NextResponse.json({
    result: "ok",
    message: "Gmail connection verified",
    setting: {
      inbound: { host: "imap.gmail.com", port: 993, encryption: "ssl" },
      outbound: { host: "smtp.gmail.com", port: 587, encryption: "starttls" },
    },
  });
}
