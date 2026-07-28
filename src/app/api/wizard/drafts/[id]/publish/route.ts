/**
 * POST /api/wizard/drafts/:id/publish — Trigger publish pipeline
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { PublishSubmissionError, submitWizardPublish } from "@/lib/wizard/publish-submission";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: draftId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    priceUsd?: number | string | null;
  };

  try {
    const result = await submitWizardPublish({
      tenantId: session.tenantId,
      actorUserId: session.id,
      draftId,
      priceUsd: body.priceUsd,
    });

    return NextResponse.json({
      listings: result.submissions.map((submission) => ({
        ...submission,
        designPairId: submission.pairId,
      })),
    });
  } catch (error) {
    if (error instanceof PublishSubmissionError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status },
      );
    }
    throw error;
  }
}
