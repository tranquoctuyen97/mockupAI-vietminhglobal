import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMcpOwner } from "@/lib/auth/require-mcp-owner";
import { prisma } from "@/lib/db";
import {
  createOwnMcpProfile,
  disableOwnMcpProfile,
  enableOwnMcpProfile,
  McpProfileError,
  resumeOwnMcpProfile,
} from "@/lib/mcp/profile-service";

const ProfileActionSchema = z.object({
  action: z.enum(["enable", "disable", "resume"]),
});

export async function GET() {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const profile = await prisma.mcpProfile.findUnique({
    where: { ownerUserId: session.id },
    include: {
      defaultStore: {
        select: { id: true, name: true, status: true },
      },
    },
  });
  return NextResponse.json({ profile });
}

export async function POST() {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  try {
    const profile = await createOwnMcpProfile(session.id);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    return mapProfileError(error);
  }
}

export async function PATCH(request: Request) {
  const { session, response } = await requireMcpOwner();
  if (response) return response;
  const parsed = ProfileActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid profile action", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const profile =
      parsed.data.action === "enable"
        ? await enableOwnMcpProfile(session.id)
        : parsed.data.action === "disable"
          ? await disableOwnMcpProfile(session.id)
          : await resumeOwnMcpProfile(session.id);
    return NextResponse.json({ profile });
  } catch (error) {
    return mapProfileError(error);
  }
}

function mapProfileError(error: unknown) {
  if (error instanceof McpProfileError) {
    const status =
      error.code === "PROFILE_NOT_FOUND" ? 404 : error.code === "INVALID_TRANSITION" ? 409 : 403;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  throw error;
}
