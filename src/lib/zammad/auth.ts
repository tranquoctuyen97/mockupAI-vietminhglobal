/**
 * Zammad authorization helpers.
 *
 * Runtime mailbox access is store-scoped. A user with the mailboxes feature can
 * use active mailboxes that belong to stores in their tenant. Per-user mailbox
 * assignment rows are retained only as deprecated data during migration.
 */
import { prisma } from "@/lib/db";

export interface MailboxAccessContext {
  userId: string;
  role: string;
  tenantId: string;
  zammadUserId: number | null;
}

export async function getMailboxAuthContext(session: {
  id: string;
  role: string;
  tenantId: string;
}): Promise<MailboxAccessContext> {
  let zammadUserId: number | null = null;
  try {
    const zammadUser = await prisma.zammadUser.findUnique({
      where: { userId: session.id },
      select: { zammadUserId: true },
    });
    zammadUserId = zammadUser?.zammadUserId ?? null;
  } catch (err) {
    // Table may not exist yet if migrations haven't been run.
    // Return null zammadUserId — reply/status operations will fail with a
    // localized "not configured" message rather than a 500.
    console.warn("[ZAMMAD] zammad_users table not available, zammadUserId set to null");
  }

  return {
    userId: session.id,
    role: session.role,
    tenantId: session.tenantId,
    zammadUserId,
  };
}

export async function listStoreMailboxes(
  ctx: MailboxAccessContext,
  storeId: string,
) {
  const store = await prisma.store.findFirst({
    where: {
      id: storeId,
      tenantId: ctx.tenantId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!store) return [];

  return prisma.mailbox.findMany({
    where: {
      tenantId: ctx.tenantId,
      storeId,
      isActive: true,
    },
    select: {
      zammadGroupId: true,
      name: true,
      email: true,
      storeId: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function requireActiveStoreMailbox(
  ctx: MailboxAccessContext,
  storeId: string,
  zammadGroupId: number,
) {
  return prisma.mailbox.findFirst({
    where: {
      tenantId: ctx.tenantId,
      storeId,
      zammadGroupId,
      isActive: true,
      store: {
        tenantId: ctx.tenantId,
        status: "ACTIVE",
        deletedAt: null,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      storeId: true,
      zammadGroupId: true,
    },
  });
}

export function requireZammadUser(ctx: MailboxAccessContext): boolean {
  return ctx.zammadUserId !== null;
}
