import "dotenv/config";

import { prisma } from "../src/lib/db";
import { getTicket } from "../src/lib/rt/client";

const DRY_RUN = !process.argv.includes("--write");
const mailboxIdArg = process.argv.find((arg) => arg.startsWith("--mailboxId="));
const mailboxId = mailboxIdArg?.slice("--mailboxId=".length);

function dateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function main() {
  const conversations = await prisma.mailboxConversation.findMany({
    where: {
      ...(mailboxId ? { mailboxId } : {}),
      rtTicketId: { not: null },
      OR: [
        { subject: null },
        { rtStatus: null },
        { rtCreatedAt: null },
        { rtLastUpdatedAt: null },
      ],
    },
    include: { mailbox: true },
    take: 500,
  });

  let updated = 0;
  for (const conversation of conversations) {
    if (!conversation.mailbox.rtQueueId || conversation.rtTicketId == null) continue;
    const ticket = await getTicket(conversation.rtTicketId);
    if (!ticket.ok || !ticket.data) continue;

    const patch = {
      subject: ticket.data.Subject || conversation.subject,
      rtStatus: ticket.data.Status || conversation.rtStatus,
      rtCreatedAt: dateOrNull(ticket.data.Created) ?? conversation.rtCreatedAt,
      rtLastUpdatedAt: dateOrNull(ticket.data.LastUpdated) ?? conversation.rtLastUpdatedAt,
      articleCount: Math.max(conversation.articleCount, Number(ticket.data.TransactionCount ?? 0)),
    };

    if (DRY_RUN) {
      console.log(JSON.stringify({ mode: "DRY_RUN", conversationId: conversation.id, patch }));
      continue;
    }

    await prisma.mailboxConversation.update({
      where: { id: conversation.id },
      data: patch,
    });
    updated += 1;
  }

  console.log(JSON.stringify({ mode: DRY_RUN ? "DRY_RUN" : "WRITE", scanned: conversations.length, updated }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
