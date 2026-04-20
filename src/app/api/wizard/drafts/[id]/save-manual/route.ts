import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(1, "Title là bắt buộc").max(255),
  description: z.string().min(1, "Description là bắt buộc").max(5000),
  tags: z.array(z.string().max(255)).max(15, "Tối đa 15 tags (Shopify limit)"),
  altText: z.string().max(512).optional(),
});

/**
 * POST /api/wizard/drafts/:id/save-manual
 * Saves manually written content (bypasses AI).
 * Sets source: "manual" to distinguish from AI-generated content.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;

  const draft = await prisma.wizardDraft.findFirst({
    where: { id: draftId, tenantId: session.tenantId },
  });

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", message: err.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const aiContent = {
    title: body.title,
    description: body.description,
    tags: body.tags,
    altText: body.altText ?? "",
    source: "manual" as const,
  };

  await prisma.wizardDraft.update({
    where: { id: draftId },
    data: { aiContent },
  });

  return NextResponse.json({ ok: true, content: aiContent });
}
