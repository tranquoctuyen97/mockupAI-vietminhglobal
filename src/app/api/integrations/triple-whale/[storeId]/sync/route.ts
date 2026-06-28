import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { enqueueTripleWhaleSync } from "@/lib/triple-whale/queue";

export async function POST(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { storeId: credentialId } = await params;
  const credential = await prisma.tripleWhaleCredential.findFirst({
    where: { id: credentialId, tenantId: session.tenantId },
  });
  if (!credential) return NextResponse.json({ error: "Credential not found" }, { status: 404 });

  await enqueueTripleWhaleSync(credentialId, session.tenantId);

  return NextResponse.json({ success: true, queued: true });
}
