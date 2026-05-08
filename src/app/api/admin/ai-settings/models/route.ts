import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { AI_PROVIDER_IDS, type AiProviderId } from "@/lib/ai/catalog";
import { getProviderModelList } from "@/lib/ai/model-discovery";

export async function GET(request: Request) {
  const { session, response } = await requireFeature("ai_settings");
  if (response) return response;

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!provider || !AI_PROVIDER_IDS.includes(provider as AiProviderId)) {
    return NextResponse.json({ error: "Provider không được hỗ trợ" }, { status: 400 });
  }

  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId: session.tenantId,
        provider,
      },
    },
  });
  const payload = await getProviderModelList(
    session.tenantId,
    provider as AiProviderId,
    providerSettings?.model,
  );

  return NextResponse.json(payload);
}
