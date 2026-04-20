/**
 * POST /api/integrations/printify/accounts — Create Printify account
 * GET  /api/integrations/printify/accounts — List Printify accounts
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { createPrintifyAccount, listPrintifyAccounts } from "@/lib/printify/account";
import { logAudit, getRequestInfo } from "@/lib/audit";

export async function GET() {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const accounts = await listPrintifyAccounts(session.tenantId);
  return NextResponse.json(accounts);
}

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { nickname, apiKey } = body as { nickname: string; apiKey: string };

  if (!nickname?.trim() || !apiKey?.trim()) {
    return NextResponse.json({ error: "nickname and apiKey are required" }, { status: 400 });
  }

  try {
    const { account, shops } = await createPrintifyAccount({
      tenantId: session.tenantId,
      nickname: nickname.trim(),
      apiKey: apiKey.trim(),
      createdBy: session.id,
    });

    const reqInfo = getRequestInfo(request);
    await logAudit({
      tenantId: session.tenantId,
      actorUserId: session.id,
      action: "printify_account.created",
      resourceType: "printify_account",
      resourceId: account.id,
      metadata: { nickname: account.nickname, shopsCount: shops.length },
      ...reqInfo,
    });

    return NextResponse.json({ account: { ...account, apiKeyEncrypted: undefined }, shops }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Handle unique constraint violation (duplicate nickname)
    if (message.includes("Unique constraint")) {
      return NextResponse.json({ error: `Nickname "${nickname}" already exists` }, { status: 409 });
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
