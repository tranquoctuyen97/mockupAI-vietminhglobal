import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { TRIPLE_WHALE_TIMEZONE_VALUES } from "@/lib/triple-whale/timezone";

const settingsSchema = z.object({
  timezone: z.enum(TRIPLE_WHALE_TIMEZONE_VALUES),
});

export async function PATCH(req: Request) {
  const { session, response } = await requireFeature("stores");
  if (response) return response;

  const parsed = settingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  await prisma.tenant.update({
    where: { id: session.tenantId },
    data: { twTimezone: parsed.data.timezone },
  });

  return NextResponse.json({ success: true });
}
