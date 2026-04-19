/**
 * Store CRUD API
 * GET /api/stores — list stores
 * POST /api/stores — create store with per-store credentials
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { listStores } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto/envelope";
import { sanitizeShopDomain } from "@/lib/shopify/oauth";

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stores = await listStores(session.tenantId);
  return NextResponse.json(stores);
}

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden - Admins only" }, { status: 403 });
  }

  const body = await request.json();
  const { name, shopifyDomain, shopifyClientId, shopifyClientSecret } = body;

  if (!name || !shopifyDomain || !shopifyClientId || !shopifyClientSecret) {
    return NextResponse.json(
      { error: "name, shopifyDomain, shopifyClientId, shopifyClientSecret required" },
      { status: 400 },
    );
  }

  let cleanDomain: string;
  try {
    cleanDomain = sanitizeShopDomain(shopifyDomain);
  } catch {
    return NextResponse.json({ error: "Invalid Shopify domain format" }, { status: 400 });
  }

  // Check duplicate
  const existing = await prisma.store.findFirst({
    where: { tenantId: session.tenantId, shopifyDomain: cleanDomain, deletedAt: null },
  });
  if (existing) {
    return NextResponse.json({ error: "Store already connected" }, { status: 409 });
  }

  // Encrypt client secret
  const { encrypted: secretEnc, keyId } = encrypt(shopifyClientSecret);

  // Create store + credentials (token null until OAuth completes)
  const store = await prisma.store.create({
    data: {
      tenantId: session.tenantId,
      name,
      shopifyDomain: cleanDomain,
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

  return NextResponse.json({ storeId: store.id, shopifyDomain: cleanDomain });
}
