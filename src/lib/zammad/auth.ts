/**
 * Zammad authorization helpers.
 *
 * Source of truth for mailbox access:
 *  - SUPER_ADMIN bypasses UserMailboxAccess (but still needs ZammadUser for write ops)
 *  - ADMIN/OPERATOR require explicit UserMailboxAccess rows
 */
import { prisma } from "@/lib/db";
import type { UserMailboxAccess } from "@prisma/client";

export interface MailboxAuthContext {
  userId: string;
  role: string;
  tenantId: string;
  zammadUserId: number | null;
  isSuperAdmin: boolean;
}

/**
 * Build an auth context for mailbox operations.
 * Fetches ZammadUser mapping for the current user.
 */
export async function getMailboxAuthContext(session: {
  id: string;
  role: string;
  tenantId: string;
}): Promise<MailboxAuthContext> {
  const zammadUser = await prisma.zammadUser.findUnique({
    where: { userId: session.id },
    select: { zammadUserId: true },
  });

  return {
    userId: session.id,
    role: session.role,
    tenantId: session.tenantId,
    zammadUserId: zammadUser?.zammadUserId ?? null,
    isSuperAdmin: session.role === "SUPER_ADMIN",
  };
}

/**
 * Get all mailbox IDs (Zammad group IDs) the user can access.
 * Returns null for SUPER_ADMIN (meaning "all").
 */
export async function getAllowedMailboxIds(
  ctx: MailboxAuthContext,
): Promise<number[] | null> {
  if (ctx.isSuperAdmin) return null; // access all
  const rows = await prisma.userMailboxAccess.findMany({
    where: { userId: ctx.userId },
    select: { zammadGroupId: true },
  });
  return rows.map((r) => r.zammadGroupId);
}

/**
 * Check if a user has access to a specific mailbox (Zammad group) ID.
 * Returns the access row (for canReply / canUpdateStatus checks), or null.
 * SUPER_ADMIN always returns a virtual "full access" object.
 */
export async function getMailboxAccess(
  ctx: MailboxAuthContext,
  mailboxId: number,
): Promise<Pick<UserMailboxAccess, "canReply" | "canUpdateStatus"> | null> {
  if (ctx.isSuperAdmin) {
    return { canReply: true, canUpdateStatus: true };
  }

  const row = await prisma.userMailboxAccess.findUnique({
    where: {
      userId_zammadGroupId: {
        userId: ctx.userId,
        zammadGroupId: mailboxId,
      },
    },
    select: { canReply: true, canUpdateStatus: true },
  });

  return row;
}

/**
 * Check if user has ZammadUser mapping (required for reply and status actions).
 */
export function requireZammadUser(ctx: MailboxAuthContext): boolean {
  return ctx.zammadUserId !== null;
}
