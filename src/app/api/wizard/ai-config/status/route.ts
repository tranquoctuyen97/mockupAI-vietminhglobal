import { NextResponse } from "next/server";
import { getProviderEnvKey, normalizeProviderId } from "@/lib/ai/catalog";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { tenantId: session.tenantId },
  });
  const provider = normalizeProviderId(settings?.activeProvider);
  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId: session.tenantId,
        provider,
      },
    },
    select: {
      configured: true,
      apiKeyEncrypted: true,
    },
  });

  const available = Boolean(
    providerSettings?.configured ||
      providerSettings?.apiKeyEncrypted ||
      process.env[getProviderEnvKey(provider)],
  );

  return NextResponse.json({ available, provider });
}
