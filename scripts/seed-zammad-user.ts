/**
 * scripts/seed-zammad-user.ts
 *
 * Admin helper to link platform users to Zammad and grant mailbox (group) access.
 *
 * Usage (link ZammadUser mapping):
 *   pnpm tsx scripts/seed-zammad-user.ts \
 *     --email operator@example.com \
 *     --zammad-user-id 5
 *
 * Usage (add/update mailbox access on top of the above):
 *   pnpm tsx scripts/seed-zammad-user.ts \
 *     --email operator@example.com \
 *     --zammad-user-id 5 \
 *     --group-id 1 \
 *     --mailbox-name "Support Inbox" \
 *     --can-reply true \
 *     --can-update-status true
 *
 * Usage (mailbox access only, ZammadUser already exists):
 *   pnpm tsx scripts/seed-zammad-user.ts \
 *     --email operator@example.com \
 *     --group-id 2 \
 *     --mailbox-name "Sales" \
 *     --can-reply false \
 *     --can-update-status false
 *
 * All operations use upsert — safe to re-run.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1] ?? "";
      args[key] = value;
      i++;
    }
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  const email = args["email"];
  const zammadUserIdRaw = args["zammad-user-id"];
  const groupIdRaw = args["group-id"];
  const mailboxName = args["mailbox-name"] ?? null;
  const canReplyRaw = args["can-reply"];
  const canUpdateStatusRaw = args["can-update-status"];

  if (!email) {
    console.error("❌  --email is required");
    console.error("\nUsage:");
    console.error("  pnpm tsx scripts/seed-zammad-user.ts --email <email> [--zammad-user-id <id>] [--group-id <id>] [--mailbox-name <name>] [--can-reply true|false] [--can-update-status true|false]");
    process.exit(1);
  }

  // ── 1. Look up platform user ───────────────────────────────────────────────

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true, tenantId: true },
  });

  if (!user) {
    console.error(`❌  No platform user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`\n👤  Platform user: ${user.email} (${user.role}, ${user.status})`);
  console.log(`    userId: ${user.id}`);
  console.log(`    tenantId: ${user.tenantId}`);

  // ── 2. Upsert ZammadUser mapping (if --zammad-user-id provided) ────────────

  if (zammadUserIdRaw) {
    const zammadUserId = parseInt(zammadUserIdRaw, 10);
    if (isNaN(zammadUserId) || zammadUserId <= 0) {
      console.error(`❌  --zammad-user-id must be a positive integer, got: "${zammadUserIdRaw}"`);
      process.exit(1);
    }

    const existing = await prisma.zammadUser.findUnique({
      where: { userId: user.id },
    });

    if (existing) {
      if (existing.zammadUserId === zammadUserId) {
        console.log(`\n✅  ZammadUser mapping already up to date (zammadUserId=${zammadUserId})`);
      } else {
        await prisma.zammadUser.update({
          where: { userId: user.id },
          data: { zammadUserId },
        });
        console.log(`\n🔄  ZammadUser mapping updated: ${existing.zammadUserId} → ${zammadUserId}`);
      }
    } else {
      await prisma.zammadUser.create({
        data: { userId: user.id, zammadUserId },
      });
      console.log(`\n✅  ZammadUser mapping created (zammadUserId=${zammadUserId})`);
    }
  } else {
    // Show existing mapping
    const existing = await prisma.zammadUser.findUnique({
      where: { userId: user.id },
    });
    if (existing) {
      console.log(`\nℹ️   ZammadUser mapping exists (zammadUserId=${existing.zammadUserId})`);
    } else {
      console.log(`\n⚠️   No ZammadUser mapping found. User cannot reply/change status until mapped.`);
      console.log(`    Add --zammad-user-id <id> to create the mapping.`);
    }
  }

  // ── 3. Upsert UserMailboxAccess (if --group-id provided) ───────────────────

  if (groupIdRaw) {
    const groupId = parseInt(groupIdRaw, 10);
    if (isNaN(groupId) || groupId <= 0) {
      console.error(`❌  --group-id must be a positive integer, got: "${groupIdRaw}"`);
      process.exit(1);
    }

    const canReply = canReplyRaw !== undefined
      ? canReplyRaw.toLowerCase() !== "false"
      : true;

    const canUpdateStatus = canUpdateStatusRaw !== undefined
      ? canUpdateStatusRaw.toLowerCase() !== "false"
      : true;

    const existing = await prisma.userMailboxAccess.findUnique({
      where: {
        userId_zammadGroupId: {
          userId: user.id,
          zammadGroupId: groupId,
        },
      },
    });

    if (existing) {
      const changed =
        existing.mailboxName !== mailboxName ||
        existing.canReply !== canReply ||
        existing.canUpdateStatus !== canUpdateStatus;

      if (!changed) {
        console.log(`\n✅  UserMailboxAccess already up to date (groupId=${groupId})`);
      } else {
        await prisma.userMailboxAccess.update({
          where: {
            userId_zammadGroupId: {
              userId: user.id,
              zammadGroupId: groupId,
            },
          },
          data: { mailboxName, canReply, canUpdateStatus },
        });
        console.log(`\n🔄  UserMailboxAccess updated:`);
        console.log(`    groupId:         ${groupId}`);
        console.log(`    mailboxName:     ${mailboxName ?? "(unchanged)"}`);
        console.log(`    canReply:        ${existing.canReply} → ${canReply}`);
        console.log(`    canUpdateStatus: ${existing.canUpdateStatus} → ${canUpdateStatus}`);
      }
    } else {
      await prisma.userMailboxAccess.create({
        data: {
          userId: user.id,
          zammadGroupId: groupId,
          mailboxName,
          canReply,
          canUpdateStatus,
        },
      });
      console.log(`\n✅  UserMailboxAccess created:`);
      console.log(`    groupId:         ${groupId}`);
      console.log(`    mailboxName:     ${mailboxName ?? "(none)"}`);
      console.log(`    canReply:        ${canReply}`);
      console.log(`    canUpdateStatus: ${canUpdateStatus}`);
    }
  }

  // ── 4. Summary ─────────────────────────────────────────────────────────────

  console.log("\n── Final state ─────────────────────────────────────────────");

  const zmUser = await prisma.zammadUser.findUnique({
    where: { userId: user.id },
  });
  console.log(`ZammadUser mapping: ${zmUser ? `zammadUserId=${zmUser.zammadUserId}` : "NONE"}`);

  const accesses = await prisma.userMailboxAccess.findMany({
    where: { userId: user.id },
    orderBy: { zammadGroupId: "asc" },
  });

  if (accesses.length === 0) {
    console.log("UserMailboxAccess: NONE (user will see empty mailbox list)");
  } else {
    console.log("UserMailboxAccess:");
    for (const a of accesses) {
      console.log(
        `  groupId=${a.zammadGroupId} name="${a.mailboxName ?? ""}" canReply=${a.canReply} canUpdateStatus=${a.canUpdateStatus}`,
      );
    }
  }
  console.log("────────────────────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error("❌  Script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
