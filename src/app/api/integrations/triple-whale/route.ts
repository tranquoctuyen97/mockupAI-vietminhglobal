import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { encrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { fetchSummaryData, TWAuthError } from "@/lib/triple-whale/client";

export async function GET() {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const [credentials, shopifyStores, tenant] = await Promise.all([
    prisma.tripleWhaleCredential.findMany({
      where: { tenantId: session.tenantId },
      select: {
        id: true,
        shopDomain: true,
        customName: true,
        encryptionKeyId: true,
        lastSyncedAt: true,
        syncFromDate: true,
        syncIntervalMinutes: true,
        syncError: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.store.findMany({
      where: { tenantId: session.tenantId, deletedAt: null },
      select: { id: true, name: true, shopifyDomain: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { twTimezone: true },
    }),
  ]);

  return NextResponse.json({
    credentials: credentials.map((c) => ({
      id: c.id,
      shopDomain: c.shopDomain,
      customName: c.customName,
      apiKeyMasked: `••••••••${c.encryptionKeyId.slice(-4)}`,
      lastSyncedAt: c.lastSyncedAt,
      syncFromDate: c.syncFromDate,
      syncIntervalMinutes: c.syncIntervalMinutes,
      syncError: c.syncError,
    })),
    shopifyStores: shopifyStores.map((s) => ({
      id: s.id,
      name: s.name,
      shopifyDomain: s.shopifyDomain,
    })),
    timezone: tenant?.twTimezone ?? "America/Los_Angeles",
  });
}

const createSchema = z.object({
  shopDomain: z.string().min(3).max(100),
  customName: z.string().min(1).max(20),
  apiKey: z.string().min(10),
  syncFromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  syncIntervalMinutes: z.number().int().min(30).default(30),
});

export async function POST(req: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
  }

  const { shopDomain, customName, apiKey, syncFromDate, syncIntervalMinutes } = parsed.data;
  const { encrypted, keyId } = encrypt(apiKey);

  const existing = await prisma.tripleWhaleCredential.findFirst({
    where: { tenantId: session.tenantId, shopDomain },
  });
  if (existing) {
    return NextResponse.json({ error: "Shop domain already configured" }, { status: 409 });
  }

  try {
    await fetchSummaryData({
      apiKey,
      shopDomain,
      startDate: syncFromDate,
      endDate: syncFromDate,
    });
  } catch (error) {
    if (error instanceof TWAuthError) {
      return NextResponse.json({ error: "Invalid Triple Whale API key" }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Triple Whale validation failed" }, { status: 502 });
  }

  const credential = await prisma.tripleWhaleCredential.create({
    data: {
      tenantId: session.tenantId,
      shopDomain,
      customName,
      apiKeyEncrypted: encrypted,
      encryptionKeyId: keyId,
      syncFromDate: new Date(`${syncFromDate}T00:00:00.000Z`),
      syncIntervalMinutes,
    },
  });

  return NextResponse.json({ success: true, id: credential.id });
}
