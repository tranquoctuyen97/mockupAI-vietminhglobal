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

  const { storeId: credentialId } = await params;
  const credential = await prisma.tripleWhaleCredential.findFirst({
    where: { id: credentialId, tenantId: session.tenantId },
  });
  if (!credential) return NextResponse.json({ error: "Credential not found" }, { status: 404 });

  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let encryptedData: { apiKeyEncrypted: Uint8Array<ArrayBuffer>; encryptionKeyId: string } | null =
    null;
  if (parsed.data.apiKey) {
    const { encrypted, keyId } = encrypt(parsed.data.apiKey);
    encryptedData = { apiKeyEncrypted: encrypted, encryptionKeyId: keyId };
  }

  await prisma.tripleWhaleCredential.update({
    where: { id: credentialId },
    data: {
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

  const { storeId: credentialId } = await params;
  const credential = await prisma.tripleWhaleCredential.findFirst({
    where: { id: credentialId, tenantId: session.tenantId },
  });
  if (!credential) return NextResponse.json({ error: "Credential not found" }, { status: 404 });

  await prisma.tripleWhaleDailyStat.deleteMany({ where: { credentialId } });
  await prisma.tripleWhaleCredential.delete({ where: { id: credentialId } });

  return NextResponse.json({ success: true });
}
