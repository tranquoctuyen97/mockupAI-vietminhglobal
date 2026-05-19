import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { encrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";

const upsertSchema = z.object({
  apiKey: z.string().min(10).optional(),
  customName: z.string().min(1).max(20),
});

export async function PUT(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { storeId } = await params;
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, deletedAt: null },
  });
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.tripleWhaleCredential.findUnique({ where: { storeId } });
  let encryptedData: { apiKeyEncrypted: Uint8Array<ArrayBuffer>; encryptionKeyId: string } | null =
    null;
  if (parsed.data.apiKey) {
    const { encrypted, keyId } = encrypt(parsed.data.apiKey);
    encryptedData = { apiKeyEncrypted: encrypted, encryptionKeyId: keyId };
  } else if (!existing) {
    return NextResponse.json({ error: "API key required for new credential" }, { status: 400 });
  }
  const createData = encryptedData ?? existing;
  if (!createData) {
    return NextResponse.json({ error: "API key required for new credential" }, { status: 400 });
  }

  await prisma.tripleWhaleCredential.upsert({
    where: { storeId },
    create: {
      storeId,
      apiKeyEncrypted: createData.apiKeyEncrypted,
      encryptionKeyId: createData.encryptionKeyId,
      customName: parsed.data.customName,
    },
    update: {
      ...(encryptedData
        ? {
            apiKeyEncrypted: encryptedData.apiKeyEncrypted,
            encryptionKeyId: encryptedData.encryptionKeyId,
          }
        : {}),
      customName: parsed.data.customName,
      syncError: null,
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const { storeId } = await params;
  const store = await prisma.store.findFirst({
    where: { id: storeId, tenantId: session.tenantId, deletedAt: null },
  });
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  await prisma.tripleWhaleDailyStat.deleteMany({ where: { storeId } });
  await prisma.tripleWhaleCredential.deleteMany({ where: { storeId } });

  return NextResponse.json({ success: true });
}
