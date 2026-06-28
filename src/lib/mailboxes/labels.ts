import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { setTicketGmailLabels } from "@/lib/rt/client";
import { getDecryptedAppPassword } from "./credentials";
import { createGmailAdapter } from "./gmail-client";
import { enqueueGmailLabelOperation } from "./queue";

type OperationType = "CREATE" | "RENAME" | "DELETE" | "ASSIGN" | "UNASSIGN";

export function normalizeGmailLabelName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function assertUserLabelName(name: string): void {
  const normalized = normalizeGmailLabelName(name);
  if (!name.trim() || name.startsWith("\\") || ["inbox", "important", "starred"].includes(normalized)) {
    throw new Error("gmail_system_label_read_only");
  }
}

export function labelOperationIdempotencyKey(input: {
  mailboxId: string;
  conversationId?: string | null;
  type: OperationType;
  labelId?: string | null;
  desiredPayload: unknown;
  requestId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export async function createLabelOperation(input: {
  mailboxId: string;
  actorUserId?: string | null;
  conversationId?: string | null;
  labelId?: string | null;
  type: OperationType;
  desiredPayload: Prisma.InputJsonObject;
  requestId: string;
}) {
  const idempotencyKey = labelOperationIdempotencyKey(input);
  const operation = await prisma.gmailLabelOperation.upsert({
    where: { idempotencyKey },
    create: {
      mailboxId: input.mailboxId,
      actorUserId: input.actorUserId,
      conversationId: input.conversationId,
      labelId: input.labelId,
      type: input.type,
      desiredPayload: input.desiredPayload,
      idempotencyKey,
      state: "PENDING",
    },
    update: {},
  });
  if (operation.state === "PENDING") {
    await enqueueGmailLabelOperation(operation.id);
  }
  return operation;
}

export async function processGmailLabelOperation(operationId: string) {
  const operation = await prisma.gmailLabelOperation.findUnique({
    where: { id: operationId },
    include: {
      mailbox: true,
      label: true,
      conversation: {
        include: {
          messages: true,
          labels: { include: { label: true } },
        },
      },
    },
  });
  if (!operation || ["SUCCEEDED", "DEAD_LETTER"].includes(operation.state)) return operation;
  if (!operation.mailbox.isActive) throw new Error("mailbox_disabled");

  await prisma.gmailLabelOperation.update({
    where: { id: operation.id },
    data: { state: "RUNNING", startedAt: new Date(), attemptCount: { increment: 1 } },
  });

  try {
    const appPassword = await getDecryptedAppPassword(operation.mailboxId);
    const gmail = createGmailAdapter({ email: operation.mailbox.email, appPassword });
    await applyOperationToGmail(operation, gmail);
    const rtUpdate = await confirmOperationInDb(operation.id);
    if (rtUpdate) {
      const result = await setTicketGmailLabels(rtUpdate.ticketId, rtUpdate.names);
      if (!result.ok) throw new Error(result.error ?? "rt_label_sync_failed");
    }
    await prisma.gmailLabelOperation.update({
      where: { id: operation.id },
      data: { state: "SUCCEEDED", errorCode: null, completedAt: new Date() },
    });
    return prisma.gmailLabelOperation.findUnique({ where: { id: operation.id } });
  } catch (error) {
    const attemptCount = operation.attemptCount + 1;
    const dead = attemptCount >= 5;
    const errorCode = safeLabelErrorCode(error);
    await prisma.$transaction(async (tx) => {
      await tx.gmailLabelOperation.update({
        where: { id: operation.id },
        data: {
          state: dead ? "DEAD_LETTER" : "FAILED",
          errorCode,
          completedAt: dead ? new Date() : null,
          nextAttemptAt: dead ? null : new Date(Date.now() + 30_000),
        },
      });
      if (dead && operation.labelId && ["CREATE", "RENAME", "DELETE"].includes(operation.type)) {
        await tx.gmailLabel.update({
          where: { id: operation.labelId },
          data: { state: "FAILED", lastErrorCode: errorCode },
        });
      }
    });
    throw error;
  }
}

async function applyOperationToGmail(
  operation: NonNullable<Awaited<ReturnType<typeof prisma.gmailLabelOperation.findUnique>>> & {
    label: { name: string } | null;
    conversation: { messages: Array<{ imapUid: bigint; direction: "INBOUND" | "OUTBOUND" }> } | null;
  },
  gmail: ReturnType<typeof createGmailAdapter>,
) {
  const payload = operation.desiredPayload as Record<string, unknown>;
  const labelName = operation.type === "RENAME"
    ? String(payload.labelName ?? "")
    : operation.label?.name ?? String(payload.labelName ?? "");
  if (["CREATE", "RENAME", "DELETE", "ASSIGN", "UNASSIGN"].includes(operation.type)) {
    assertUserLabelName(labelName || String(payload.name ?? ""));
  }

  if (operation.type === "CREATE") {
    await gmail.createLabel(String(payload.name));
    return;
  }
  if (operation.type === "RENAME") {
    await gmail.renameLabel(labelName, String(payload.newName));
    return;
  }
  if (operation.type === "DELETE") {
    await gmail.deleteLabel(labelName);
    return;
  }

  const uids = operation.conversation?.messages
    .filter((message) => message.direction === "INBOUND")
    .map((message) => Number(message.imapUid)) ?? [];
  if (uids.length === 0) return;
  if (operation.type === "ASSIGN") await gmail.assignLabel(uids, labelName);
  if (operation.type === "UNASSIGN") await gmail.unassignLabel(uids, labelName);
}

async function confirmOperationInDb(operationId: string) {
  return prisma.$transaction(async (tx) => {
    const operation = await tx.gmailLabelOperation.findUnique({
      where: { id: operationId },
      include: {
        label: true,
        conversation: {
          include: { labels: { include: { label: true } } },
        },
      },
    });
    if (!operation) return null;
    const payload = operation.desiredPayload as Record<string, unknown>;

    if (operation.type === "CREATE") {
      const name = String(payload.name);
      await tx.gmailLabel.upsert({
        where: { mailboxId_normalizedName: { mailboxId: operation.mailboxId, normalizedName: normalizeGmailLabelName(name) } },
        create: {
          mailboxId: operation.mailboxId,
          name,
          normalizedName: normalizeGmailLabelName(name),
          type: "USER",
          isMutable: true,
          state: "ACTIVE",
          confirmedAt: new Date(),
        },
        update: { name, state: "ACTIVE", lastErrorCode: null, confirmedAt: new Date() },
      });
    }

    if (operation.type === "RENAME" && operation.labelId) {
      const newName = String(payload.newName);
      await tx.gmailLabel.update({
        where: { id: operation.labelId },
        data: {
          name: newName,
          normalizedName: normalizeGmailLabelName(newName),
          state: "ACTIVE",
          lastErrorCode: null,
          confirmedAt: new Date(),
        },
      });
    }

    if (operation.type === "DELETE" && operation.labelId) {
      await tx.conversationLabel.deleteMany({ where: { labelId: operation.labelId } });
      await tx.gmailLabel.delete({ where: { id: operation.labelId } });
    }

    if (operation.type === "ASSIGN" && operation.conversationId && operation.labelId) {
      await tx.conversationLabel.upsert({
        where: { conversationId_labelId: { conversationId: operation.conversationId, labelId: operation.labelId } },
        create: { conversationId: operation.conversationId, labelId: operation.labelId },
        update: { confirmedAt: new Date() },
      });
    }

    if (operation.type === "UNASSIGN" && operation.conversationId && operation.labelId) {
      await tx.conversationLabel.deleteMany({
        where: { conversationId: operation.conversationId, labelId: operation.labelId },
      });
    }

    const nextLabels = operation.conversationId
      ? await tx.conversationLabel.findMany({
          where: { conversationId: operation.conversationId },
          include: { label: true },
        })
      : [];

    return operation.conversation?.rtTicketId && operation.conversationId
      ? {
          ticketId: operation.conversation.rtTicketId,
          names: nextLabels.map((join) => join.label.name),
        }
      : null;
  });
}

function safeLabelErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_:-]+$/i.test(error.message)) {
    return error.message.slice(0, 120);
  }
  return "gmail_label_operation_failed";
}
