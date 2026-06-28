import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { enqueueTripleWhaleSync } from "@/lib/triple-whale/queue";

export async function POST() {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const credentials = await prisma.tripleWhaleCredential.findMany({
    where: { tenantId: session.tenantId },
    select: { id: true },
  });

  await Promise.all(
    credentials.map((credential) =>
      enqueueTripleWhaleSync(credential.id, session.tenantId),
    ),
  );

  return NextResponse.json({ success: true, queued: credentials.length });
}
