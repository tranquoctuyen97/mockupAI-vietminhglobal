import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { listStores } from "@/lib/stores/store-service";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto/envelope";
import { sanitizeShopDomain } from "@/lib/shopify/oauth";
import { z } from "zod";

const CreateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  shopifyDomain: z
    .string()
    .min(1, "Shopify domain is required")
    .regex(/\.myshopify\.com$/, "Must be a valid .myshopify.com domain"),
  shopifyClientId: z.string().min(10, "Client ID too short"),
  shopifyClientSecret: z.string().min(10, "Client Secret too short"),
});

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
  const parsed = CreateStoreSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { name, shopifyDomain, shopifyClientId, shopifyClientSecret } = parsed.data;

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
