import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_PRINT_AREA } from "@/lib/placement/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const blueprintId = parseInt(id, 10);
    if (isNaN(blueprintId)) {
      return NextResponse.json({ error: "Invalid blueprint ID" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const position = (searchParams.get("position") || "FRONT").toUpperCase();

    // Look it up in DB
    const area = await db.blueprintPrintArea.findFirst({
      where: {
        printifyBlueprintId: blueprintId,
        position: position as any,
      },
    });

    if (area) {
      return NextResponse.json({
        printArea: {
          widthMm: area.widthMm,
          heightMm: area.heightMm,
          safeMarginMm: area.safeMarginMm,
        },
      });
    }

    // Fallback to default if not synced yet
    return NextResponse.json({
      printArea: DEFAULT_PRINT_AREA,
      note: "Using default print area fallback",
    });
  } catch (error) {
    console.error(`GET /api/blueprint/print-area error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
