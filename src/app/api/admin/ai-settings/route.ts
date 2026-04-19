import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto/envelope";

/**
 * GET /api/admin/ai-settings — Get AI settings (key masked)
 * PUT /api/admin/ai-settings — Update settings (encrypt new key)
 */
export async function GET() {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });

  if (!settings) {
    return NextResponse.json({
      settings: {
        provider: "gemini",
        model: "gemini-2.5-flash",
        apiKeyMasked: "",
        promptVersion: 1,
        hasKey: false,
      },
    });
  }

  // Mask key: show last 4 chars
  let apiKeyMasked = "";
  try {
    const raw = decrypt(settings.apiKeyEncrypted);
    apiKeyMasked = raw.length > 4 ? "••••" + raw.slice(-4) : "••••";
  } catch {
    apiKeyMasked = "(decryption failed)";
  }

  // Get today's cost
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const costAgg = await prisma.aiContentCache.aggregate({
    where: {
      provider: settings.provider,
      createdAt: { gte: todayStart },
    },
    _sum: { costUsd: true, tokensIn: true, tokensOut: true },
    _count: true,
  });

  return NextResponse.json({
    settings: {
      provider: settings.provider,
      model: settings.model,
      apiKeyMasked,
      promptVersion: settings.promptVersion,
      hasKey: true,
    },
    todayCost: {
      totalCostUsd: costAgg._sum.costUsd || 0,
      totalTokensIn: costAgg._sum.tokensIn || 0,
      totalTokensOut: costAgg._sum.tokensOut || 0,
      requestCount: costAgg._count || 0,
    },
  });
}

export async function PUT(request: Request) {
  const session = await validateSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json();
  const { provider, model, apiKey } = body as {
    provider?: string;
    model?: string;
    apiKey?: string;
  };

  // Build update payload
  const updateData: Record<string, unknown> = {};

  if (provider) updateData.provider = provider;
  if (model) updateData.model = model;

  // Only update API key if new value provided
  if (apiKey && apiKey.trim().length > 0) {
    const { encrypted, keyId } = encrypt(apiKey.trim());
    updateData.apiKeyEncrypted = encrypted;
    updateData.encryptionKeyId = keyId;
  }

  // Upsert
  const existing = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });

  if (existing) {
    await prisma.aiSettings.update({
      where: { tenantId: session.tenantId },
      data: updateData,
    });
  } else {
    // Must have API key for create
    if (!apiKey || apiKey.trim().length === 0) {
      return NextResponse.json({ error: "API key required for initial setup" }, { status: 400 });
    }
    const { encrypted, keyId } = encrypt(apiKey.trim());
    await prisma.aiSettings.create({
      data: {
        tenantId: session.tenantId,
        provider: (provider as string) || "gemini",
        model: (model as string) || "gemini-2.5-flash",
        apiKeyEncrypted: encrypted,
        encryptionKeyId: keyId,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
