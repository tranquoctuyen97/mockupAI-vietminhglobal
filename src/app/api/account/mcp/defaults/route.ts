import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { prisma } from "@/lib/db";

const DefaultsSchema = z.object({
  defaultStoreId: z.string().min(1).nullable(),
});

export async function PATCH(request: Request) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const parsed = DefaultsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid MCP defaults", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.defaultStoreId) {
    const store = await prisma.store.findFirst({
      where: {
        id: parsed.data.defaultStoreId,
        tenantId: session.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!store) {
      return NextResponse.json({ error: "Store not found in your tenant" }, { status: 404 });
    }
  }

  const profile = await prisma.mcpProfile.update({
    where: { ownerUserId: session.id },
    data: { defaultStoreId: parsed.data.defaultStoreId },
    select: {
      id: true,
      defaultStoreId: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ profile });
}
