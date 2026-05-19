import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

const settingsSchema = z.object({
  timezone: z.string().min(1),
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
