/**
 * Admin Mailbox — Test connection (inbound/outbound) + Probe
 *
 * POST /api/admin/mailboxes/test-connection
 *
 * Modes:
 * 1. Probe mode: { probe: true, email, password } → auto-detect IMAP/SMTP
 * 2. Manual mode: { inbound?, outbound? } → test specific connections
 *
 * Passwords are never logged. Zammad masks them in responses.
 */
import { NextResponse } from "next/server";
import { requireMailboxAdmin } from "@/lib/auth/mailbox-admin-guard";
import { testConnectionSchema, toZammadInboundSsl, toZammadOutboundSsl } from "@/lib/zammad/admin-validation";
import { testEmailInbound, testEmailOutbound, probeEmailSettings } from "@/lib/zammad/client";
import type { ZammadInboundConfig, ZammadOutboundConfig, ZammadConnectionTestResult } from "@/lib/zammad/types";

export async function POST(request: Request) {
  const guard = await requireMailboxAdmin();
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Probe mode: auto-detect from email + password ─────────────────────
  if (body.probe === true) {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required for probe" }, { status: 400 });
    }
    const res = await probeEmailSettings({ email, password });
    if (res.ok && res.data) {
      return NextResponse.json(res.data);
    }
    // Return error details for debugging
    return NextResponse.json({
      result: "failed",
      message: res.error === "timeout"
        ? "Kết nối tới email server quá lâu. Vui lòng thử lại."
        : res.error === "network_error"
          ? "Không thể kết nối tới hệ thống email. Vui lòng thử lại sau."
          : res.data?.message || res.data?.message_human || "Probe failed",
      message_human: res.data?.message_human,
    });
  }

  // ── Manual mode: test specific inbound/outbound ───────────────────────
  const parsed = testConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const results: { inbound?: ZammadConnectionTestResult; outbound?: ZammadConnectionTestResult } = {};

  // Test inbound
  if (parsed.data.inbound) {
    const inbound: ZammadInboundConfig = {
      adapter: "imap",
      options: {
        host: parsed.data.inbound.host,
        port: String(parsed.data.inbound.port),
        ssl: toZammadInboundSsl(parsed.data.inbound.encryption),
        user: parsed.data.inbound.username,
        password: parsed.data.inbound.password,
        folder: parsed.data.inbound.folder ?? "inbox",
      },
    };
    const res = await testEmailInbound(inbound);
    results.inbound = res.data ?? { result: "failed", message: "Connection failed" };
  }

  // Test outbound
  if (parsed.data.outbound) {
    const outbound: ZammadOutboundConfig & { email: string } = {
      adapter: "smtp",
      options: {
        host: parsed.data.outbound.host,
        port: parsed.data.outbound.port,
        ssl: toZammadOutboundSsl(parsed.data.outbound.encryption),
        user: parsed.data.outbound.username,
        password: parsed.data.outbound.password,
      },
      email: parsed.data.outbound.email,
    };
    const res = await testEmailOutbound(outbound);
    results.outbound = res.data ?? { result: "failed", message: "Connection failed" };
  }

  return NextResponse.json(results);
}
