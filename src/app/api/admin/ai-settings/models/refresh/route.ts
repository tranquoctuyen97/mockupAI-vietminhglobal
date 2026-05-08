import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { AI_PROVIDER_IDS, type AiProviderId } from "@/lib/ai/catalog";
import { refreshProviderModelList } from "@/lib/ai/model-discovery";

const RefreshModelsSchema = z.object({
  provider: z.string(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export async function POST(request: Request) {
  const { session, response } = await requireFeature("ai_settings");
  if (response) return response;

  const body = await readJsonBody(request);
  const parsed = RefreshModelsSchema.safeParse(body);
  if (!parsed.success || !AI_PROVIDER_IDS.includes(parsed.data.provider as AiProviderId)) {
    return NextResponse.json({ error: "Provider không được hỗ trợ" }, { status: 400 });
  }

  const provider = parsed.data.provider as AiProviderId;
  const providerSettings = await prisma.aiProviderSettings.findUnique({
    where: {
      tenantId_provider: {
        tenantId: session.tenantId,
        provider,
      },
    },
  });

  try {
    const payload = await refreshProviderModelList({
      tenantId: session.tenantId,
      provider,
      apiKey: parsed.data.apiKey,
      selectedModel: parsed.data.model ?? providerSettings?.model,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không tải được model mới",
      },
      { status: 400 },
    );
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
