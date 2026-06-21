/**
 * Admin Mailbox — Auto-probe email settings
 *
 * POST /api/admin/mailboxes/probe
 *
 * Discovers IMAP/SMTP settings from email + password.
 * Passwords are masked in Zammad response.
 */
import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { probeSchema } from "@/lib/zammad/admin-validation";
import { probeEmailSettings } from "@/lib/zammad/client";

export async function POST(request: Request) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = probeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await probeEmailSettings(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Email probe failed" },
      { status: 502 },
    );
  }

  return NextResponse.json(result.data);
}
