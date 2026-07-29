import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { normalizeColorNameKey } from "@/lib/designs/color-classifier";
import { listColorGroupOverrides } from "@/lib/designs/color-group-overrides";

const VALID_COLOR_GROUPS = new Set(["auto", "light", "dark"]);

const UpdateColorGroupSchema = z.object({
  colorName: z.string().min(1),
  colorGroup: z.enum(["auto", "light", "dark"]),
});

type ColorSummaryRow = {
  colorNameKey: string;
  colorName: string;
  hex: string | null;
  rowsCount: number;
  storesCount: number;
  catalogsCount: number;
};

function isAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export async function GET() {
  const session = await validateSession();
  if (!session || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [overrides, colorRows] = await Promise.all([
    listColorGroupOverrides(session.tenantId),
    prisma.$queryRaw<ColorSummaryRow[]>`
      WITH store_color_summary AS (
        SELECT
          lower(regexp_replace(trim(sc."name"), '\\s+', ' ', 'g')) AS "colorNameKey",
          min(sc."name") AS "colorName",
          min(sc."hex") AS "hex",
          count(*)::int AS "rowsCount",
          count(DISTINCT sc."store_id")::int AS "storesCount"
        FROM "store_colors" sc
        JOIN "stores" s ON s."id" = sc."store_id"
        WHERE s."tenant_id" = ${session.tenantId}
        GROUP BY lower(regexp_replace(trim(sc."name"), '\\s+', ' ', 'g'))
      ),
      cached_color_summary AS (
        SELECT
          lower(regexp_replace(trim(pvc."color_name"), '\\s+', ' ', 'g')) AS "colorNameKey",
          min(pvc."color_name") AS "colorName",
          min(pvc."color_hex") AS "hex",
          count(DISTINCT pvc."blueprint_id" || ':' || pvc."print_provider_id")::int AS "catalogsCount"
        FROM "printify_variant_cache" pvc
        GROUP BY lower(regexp_replace(trim(pvc."color_name"), '\\s+', ' ', 'g'))
      ),
      color_keys AS (
        SELECT "colorNameKey" FROM store_color_summary
        UNION
        SELECT "colorNameKey" FROM cached_color_summary
      )
      SELECT
        ck."colorNameKey",
        coalesce(scs."colorName", ccs."colorName", ck."colorNameKey") AS "colorName",
        coalesce(ccs."hex", scs."hex") AS "hex",
        coalesce(scs."rowsCount", 0)::int AS "rowsCount",
        coalesce(scs."storesCount", 0)::int AS "storesCount",
        coalesce(ccs."catalogsCount", 0)::int AS "catalogsCount"
      FROM color_keys ck
      LEFT JOIN store_color_summary scs ON scs."colorNameKey" = ck."colorNameKey"
      LEFT JOIN cached_color_summary ccs ON ccs."colorNameKey" = ck."colorNameKey"
      ORDER BY ck."colorNameKey"
    `,
  ]);

  const colorByKey = new Map(colorRows.map((row) => [row.colorNameKey, row]));

  const configured = overrides.map((override) => {
    const color = colorByKey.get(override.colorNameKey);
    return {
      id: override.id,
      colorName: override.colorName,
      colorNameKey: override.colorNameKey,
      colorGroup: override.colorGroup,
      source: override.source,
      hex: color?.hex ?? null,
      storesCount: color?.storesCount ?? 0,
      rowsCount: color?.rowsCount ?? 0,
      catalogsCount: color?.catalogsCount ?? 0,
      updatedAt: override.updatedAt.toISOString(),
    };
  });

  const colors = colorRows.map((row) => {
    const override = overrides.find((candidate) => candidate.colorNameKey === row.colorNameKey);
    return {
      ...row,
      colorGroup: override?.colorGroup ?? "auto",
    };
  });

  return NextResponse.json({ configured, colors });
}

export async function PATCH(request: Request) {
  const session = await validateSession();
  if (!session || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = UpdateColorGroupSchema.safeParse(body);
  if (!parsed.success || !VALID_COLOR_GROUPS.has(String(body.colorGroup))) {
    return NextResponse.json({ error: "colorName and colorGroup are required" }, { status: 400 });
  }

  const colorName = parsed.data.colorName.trim();
  const colorNameKey = normalizeColorNameKey(colorName);

  if (parsed.data.colorGroup === "auto") {
    await prisma.colorGroupOverride.deleteMany({
      where: { tenantId: session.tenantId, colorNameKey },
    });
    return NextResponse.json({ colorName, colorNameKey, colorGroup: "auto" });
  }

  const override = await prisma.colorGroupOverride.upsert({
    where: {
      tenantId_colorNameKey: {
        tenantId: session.tenantId,
        colorNameKey,
      },
    },
    create: {
      tenantId: session.tenantId,
      colorName,
      colorNameKey,
      colorGroup: parsed.data.colorGroup,
      source: "admin",
    },
    update: {
      colorName,
      colorGroup: parsed.data.colorGroup,
      source: "admin",
    },
  });

  return NextResponse.json({ override });
}
