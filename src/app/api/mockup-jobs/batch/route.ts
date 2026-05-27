import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import {
  type BatchMockupJobFailure,
  MockupGenerationError,
  createCustomMockupJobForDraftDesign,
  createMockupJobForDraftDesign,
  loadMockupGenerationContext,
  prepareMockupGeneration,
} from "@/lib/mockup/generation";

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { draftId } = body;
  if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });

  try {
    const context = await loadMockupGenerationContext(draftId, session.tenantId);
    const prepared = await prepareMockupGeneration(context);
    const draftDesigns = context.draft.draftDesigns;

    if (draftDesigns.length === 0) {
      throw new MockupGenerationError("No designs attached to draft", 400);
    }

    const jobs = [];
    const failures: BatchMockupJobFailure[] = [];

    for (const draftDesign of draftDesigns) {
      try {
        const job = prepared.isCustom
          ? await createCustomMockupJobForDraftDesign(context, prepared, draftDesign)
          : await createMockupJobForDraftDesign(context, prepared, draftDesign);
        jobs.push(job);
      } catch (error) {
        failures.push({
          draftDesignId: draftDesign.id,
          designId: draftDesign.designId,
          designName: draftDesign.design.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ jobs, failures });
  } catch (error) {
    if (error instanceof MockupGenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Batch mockup generation failed:", error);
    return NextResponse.json(
      {
        error: `Không tạo được mockup: ${message}`,
        code: "MOCKUP_GENERATION_FAILED",
      },
      { status: 502 },
    );
  }
}
