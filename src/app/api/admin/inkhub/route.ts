import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";
import { invalidateToken } from "@/lib/inkhub/token";

// GET — load current config (username only, never return password)
export async function GET() {
  const { session, response } = await requireFeature("inkhub_config");
  if (response) return response;

  const row = await prisma.inkhubCredential.findUnique({
    where: { tenantId: session.tenantId },
  });
  return NextResponse.json({ username: row?.username ?? "" });
}

// PUT — save new credentials
export async function PUT(request: Request) {
  const { session, response } = await requireFeature("inkhub_config");
  if (response) return response;

  const { username, password } = await request.json() as { username: string; password: string };
  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }

  const { encrypted } = encrypt(password);

  await prisma.inkhubCredential.upsert({
    where: { tenantId: session.tenantId },
    create: { tenantId: session.tenantId, username, passwordEncrypted: encrypted },
    update: { username, passwordEncrypted: encrypted },
  });

  invalidateToken(session.tenantId);

  return NextResponse.json({ ok: true });
}

// DELETE — remove credentials
export async function DELETE() {
  const { session, response } = await requireFeature("inkhub_config");
  if (response) return response;

  await prisma.inkhubCredential.deleteMany({
    where: { tenantId: session.tenantId },
  });

  invalidateToken(session.tenantId);

  return NextResponse.json({ ok: true });
}
