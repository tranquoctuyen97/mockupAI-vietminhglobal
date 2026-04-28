import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { copyPlacementOnce } from "@/lib/placement/copy-to-variants";
import type { PlacementData, ViewKey } from "@/lib/placement/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const { fromVariantKey, view, targetVariantKeys } = body as {
      fromVariantKey: string;
      view: ViewKey;
      targetVariantKeys: string[];
    };

    if (!fromVariantKey || !view || !targetVariantKeys || targetVariantKeys.length === 0) {
      return NextResponse.json(
        { error: "fromVariantKey, view, and targetVariantKeys are required" },
        { status: 400 },
      );
    }

    const draft = await db.wizardDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    let placementData = draft.placementOverride as unknown as PlacementData;
    if (!placementData || placementData.version !== 2) {
      return NextResponse.json(
        { error: "No placement data to copy" },
        { status: 400 },
      );
    }

    // Apply copy
    const newVariants = copyPlacementOnce(
      placementData.variants,
      fromVariantKey,
      view,
      targetVariantKeys,
    );
    
    placementData.variants = newVariants;

    // Save
    await db.wizardDraft.update({
      where: { id: draftId },
      data: {
        placementOverride: placementData as any,
      },
    });

    return NextResponse.json({
      success: true,
      placementData,
    });
  } catch (error) {
    console.error(`POST /api/wizard/drafts/placement/copy error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
