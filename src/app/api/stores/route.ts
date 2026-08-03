import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { validateSession } from "@/lib/auth/session";
import { encrypt } from "@/lib/crypto/envelope";
import { prisma } from "@/lib/db";
import { fetchInkhubShopStats } from "@/lib/inkhub/orders-client";
import { enqueueInkhubInitialSync } from "@/lib/inkhub/queue";
import { sanitizeShopDomain } from "@/lib/shopify/oauth";
import { listStores } from "@/lib/stores/store-service";

const CreateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  shopifyDomain: z
    .string()
    .min(1, "Shopify domain is required")
    .regex(/\.myshopify\.com$/, "Must be a valid .myshopify.com domain"),
  shopifyClientId: z.string().min(10, "Client ID too short"),
  shopifyClientSecret: z.string().min(10, "Client Secret too short"),
  inkhubShopId: z.preprocess(
    (value) =>
      value === "" || value === undefined ? undefined : value === null ? null : Number(value),
    z.number().int().nonnegative().nullable().optional(),
  ),
});

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stores = await listStores(session.tenantId);
  return NextResponse.json(stores, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const body = await request.json();
  const parsed = CreateStoreSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { name, shopifyDomain, shopifyClientId, shopifyClientSecret, inkhubShopId } = parsed.data;

  let cleanDomain: string;
  try {
    cleanDomain = sanitizeShopDomain(shopifyDomain);
  } catch {
    return NextResponse.json({ error: "Invalid Shopify domain format" }, { status: 400 });
  }

  // Check duplicate
  const existing = await prisma.store.findFirst({
    where: { tenantId: session.tenantId, shopifyDomain: cleanDomain },
  });
  if (existing) {
    return NextResponse.json({ error: "Store already connected" }, { status: 409 });
  }

  let inkhubShopLabel: string | null = null;
  if (inkhubShopId !== undefined && inkhubShopId !== null) {
    const duplicateInkhubShop = await prisma.store.findFirst({
      where: { tenantId: session.tenantId, inkhubShopId, deletedAt: null },
      select: { id: true },
    });
    if (duplicateInkhubShop) {
      return NextResponse.json(
        { error: "This Inkhub shop is already mapped to another store" },
        { status: 409 },
      );
    }
    try {
      const shop = (await fetchInkhubShopStats(session.tenantId)).find(
        (candidate) => candidate.id === inkhubShopId,
      );
      if (!shop) return NextResponse.json({ error: "Inkhub shop not found" }, { status: 400 });
      inkhubShopLabel = shop.label;
    } catch (error) {
      console.error("[Stores] Failed to validate Inkhub shop mapping:", error);
      return NextResponse.json(
        { error: "Unable to validate Inkhub shop right now" },
        { status: 502 },
      );
    }
  }

  // Encrypt client secret
  const { encrypted: secretEnc, keyId } = encrypt(shopifyClientSecret);

  // Create store + credentials (token null until OAuth completes)
  const store = await prisma.store.create({
    data: {
      tenantId: session.tenantId,
      name,
      shopifyDomain: cleanDomain,
      inkhubShopId: inkhubShopId ?? null,
      inkhubShopLabel,
      status: "ACTIVE",
      createdBy: session.id,
      credentials: {
        create: {
          shopifyClientId,
          shopifyClientSecretEnc: secretEnc,
          encryptionKeyId: keyId,
        },
      },
    },
  });

  let inkhubInitialSyncQueued = false;
  if (inkhubShopId !== undefined && inkhubShopId !== null) {
    try {
      await enqueueInkhubInitialSync({
        tenantId: session.tenantId,
        storeId: store.id,
        shopIds: [inkhubShopId],
      });
      inkhubInitialSyncQueued = true;
    } catch (error) {
      console.error("[Stores] Failed to enqueue Inkhub initial sync:", error);
    }
  }

  return NextResponse.json({
    storeId: store.id,
    shopifyDomain: cleanDomain,
    inkhubInitialSyncQueued,
  });
}
