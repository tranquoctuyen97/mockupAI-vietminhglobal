import "dotenv/config";
import { prisma } from "@/lib/db";
import { getDecryptedAppPassword } from "@/lib/mailboxes/credentials";
import { createGmailAdapter } from "@/lib/mailboxes/gmail-client";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function backfillMailbox(mailbox: { id: string; email: string }, limit: number, dryRun: boolean) {
  const conversations = await prisma.mailboxConversation.findMany({
    where: { mailboxId: mailbox.id, gmailThreadId: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, gmailThreadId: true, articleCount: true },
  });

  const gmail = createGmailAdapter({
    email: mailbox.email,
    appPassword: await getDecryptedAppPassword(mailbox.id),
  });

  let checked = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const conversation of conversations) {
    checked += 1;
    try {
      const thread = await gmail.fetchThreadMessages(conversation.gmailThreadId);
      const messageCount = thread.messages.length;
      if (messageCount === 0) {
        skipped += 1;
        continue;
      }
      if (messageCount !== conversation.articleCount) {
        updated += 1;
        if (!dryRun) {
          await prisma.mailboxConversation.update({
            where: { id: conversation.id },
            data: { articleCount: messageCount },
          });
        }
      } else {
        unchanged += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`[backfill] failed conversationId=${conversation.id} gmailThreadId=${conversation.gmailThreadId}`, error);
      continue;
    }
  }

  console.log(`[backfill] mailboxId=${mailbox.id} checked=${checked} updated=${updated} unchanged=${unchanged} skipped=${skipped} failed=${failed} dryRun=${dryRun}`);
}

async function main() {
  const mailboxId = argValue("--mailbox-id");
  const limitValue = argValue("--limit");
  const limit = limitValue ? Number.parseInt(limitValue, 10) : 100;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const dryRun = hasFlag("--dry-run");

  const mailboxes = await prisma.mailbox.findMany({
    where: mailboxId ? { id: mailboxId, isActive: true } : { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (mailboxes.length === 0) {
    throw new Error(mailboxId ? `active mailbox not found: ${mailboxId}` : "no active mailboxes found");
  }

  for (const mailbox of mailboxes) {
    await backfillMailbox(mailbox, limit, dryRun);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
