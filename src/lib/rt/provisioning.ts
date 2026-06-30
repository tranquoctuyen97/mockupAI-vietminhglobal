import { prisma } from "@/lib/db";
import { materializeRuntimeSecret, removeRuntimeSecret } from "@/lib/mailboxes/credentials";
import {
  removeRuntimeMailboxConfigs,
  writeRuntimeMailboxConfig,
} from "@/lib/mailboxes/runtime-config";
import {
  attachCustomFieldToQueue,
  createQueue,
  disableQueue,
  findQueueByName,
  findOrCreateGmailLabelsCustomField,
  grantQueueRights,
  updateQueue,
} from "./client";

const DEFAULT_RUNTIME_DIR = process.env.MAILBOX_RUNTIME_DIR ?? "/run/mockupai-mailboxes";
const SERVICE_PRINCIPAL = process.env.RT_MAILBOX_SERVICE_PRINCIPAL ?? "mailbox-service";
const MAILGATE_PRINCIPAL = process.env.RT_MAILGATE_GROUP_PRINCIPAL ?? "Everyone";
const REQUIRED_QUEUE_RIGHTS = [
  "CreateTicket",
  "ReplyToTicket",
  "SeeQueue",
  "ShowTicket",
  "ModifyTicket",
];

export interface ProvisionMailboxDeps {
  load(mailboxId: string): Promise<ProvisionMailboxRecord | null>;
  createQueue(input: { name: string; description: string; correspondAddress: string }): Promise<{ ok: boolean; id?: number; error?: string }>;
  updateQueue(queueId: number, input: { name: string; description: string; correspondAddress: string; disabled?: boolean }): Promise<{ ok: boolean; error?: string }>;
  findQueueByName?(name: string): Promise<{ ok: boolean; id?: number | string | { id?: number | string } | null; error?: string }>;
  disableQueue(queueId: number): Promise<void>;
  ensureLabelsCustomField(queueId: number): Promise<{ ok: boolean; error?: string }>;
  grantRights(queueId: number): Promise<{ ok: boolean; error?: string }>;
  materialize(mailbox: ProvisionMailboxRecord): Promise<void>;
  markActive(mailboxId: string, queueId: number): Promise<void>;
  markDegraded(mailboxId: string, code: string): Promise<void>;
}

export interface ProvisionMailboxRecord {
  id: string;
  name: string;
  email: string;
  initialSyncAfter: Date;
  rtQueueId: number | null;
  store: { name: string };
  syncCursor: { lastCommittedUid: bigint } | null;
}

async function findExistingQueueId(queueName: string, deps: ProvisionMailboxDeps): Promise<number | null> {
  if (!deps.findQueueByName) return null;
  const found = await deps.findQueueByName(queueName);
  return found.ok ? numericId(found.id) : null;
}

export async function provisionMailbox(
  mailboxId: string,
  deps: ProvisionMailboxDeps = prismaProvisionMailboxDeps,
): Promise<{ status: "ACTIVE"; queueId: number } | { status: "DEGRADED"; errorCode: string }> {
  const mailbox = await deps.load(mailboxId);
  if (!mailbox) throw new Error("mailbox_not_found");

  let queueId = mailbox.rtQueueId;
  try {
    console.log(
      `[MailboxProvision] start mailboxId=${mailbox.id} name=${mailbox.name} email=${mailbox.email} queueId=${queueId ?? "none"}`,
    );
    const queueName = rtQueueName(mailbox.id);
    const description = `${mailbox.store.name} / ${mailbox.name}`;
    if (queueId) {
      const updated = await deps.updateQueue(queueId, {
        name: queueName,
        description,
        correspondAddress: mailbox.email,
        disabled: false,
      });
      if (!updated.ok) throw new Error(updated.error ?? "rt_queue_update_failed");
    } else {
      const created = await deps.createQueue({
        name: queueName,
        description,
        correspondAddress: mailbox.email,
      });
      queueId = created.ok ? created.id ?? null : null;
      if (!queueId && created.error === "rt_upstream_400") {
        queueId = await findExistingQueueId(queueName, deps);
      }
      if (!queueId) throw new Error(created.error ?? "rt_queue_create_failed");
      const updated = await deps.updateQueue(queueId, {
        name: queueName,
        description,
        correspondAddress: mailbox.email,
        disabled: false,
      });
      if (!updated.ok) throw new Error(updated.error ?? "rt_queue_update_failed");
    }

    const customField = await deps.ensureLabelsCustomField(queueId);
    if (!customField.ok) throw new Error(customField.error ?? "rt_custom_field_failed");
    const rights = await deps.grantRights(queueId);
    if (!rights.ok) throw new Error(rights.error ?? "rt_rights_failed");
    await deps.materialize(mailbox);
    await deps.markActive(mailbox.id, queueId);
    console.log(
      `[MailboxProvision] active mailboxId=${mailbox.id} name=${mailbox.name} email=${mailbox.email} queueId=${queueId}`,
    );
    return { status: "ACTIVE", queueId };
  } catch (error) {
    const errorCode = safeProvisioningErrorCode(error);
    if (queueId) await deps.disableQueue(queueId).catch(() => undefined);
    await deps.markDegraded(mailbox.id, errorCode);
    console.log(
      `[MailboxProvision] degraded mailboxId=${mailbox.id} name=${mailbox.name} email=${mailbox.email} errorCode=${errorCode}`,
    );
    return { status: "DEGRADED", errorCode };
  }
}

export async function disableProvisionedMailbox(mailboxId: string): Promise<void> {
  const mailbox = await prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { id: true, rtQueueId: true },
  });
  if (!mailbox) throw new Error("mailbox_not_found");
  if (mailbox.rtQueueId) await disableQueue(mailbox.rtQueueId).catch(() => undefined);
  await Promise.all([
    removeRuntimeSecret(mailbox.id, DEFAULT_RUNTIME_DIR).catch(() => undefined),
    removeRuntimeMailboxConfigs(mailbox.id, DEFAULT_RUNTIME_DIR).catch(() => undefined),
  ]);
  await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { isActive: false, syncStatus: "DISABLED", lastSyncErrorCode: null },
  });
}

export function rtQueueName(mailboxId: string): string {
  return `vmg-mailbox-${mailboxId}`;
}

function numericId(value: unknown): number | null {
  const raw = typeof value === "object" && value && "id" in value ? value.id : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeProvisioningErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_:-]+$/i.test(error.message)) {
    return error.message.slice(0, 120);
  }
  return "mailbox_provisioning_failed";
}

export const prismaProvisionMailboxDeps: ProvisionMailboxDeps = {
  load: (mailboxId) =>
    prisma.mailbox.findUnique({
      where: { id: mailboxId },
      select: {
        id: true,
        name: true,
        email: true,
        initialSyncAfter: true,
        rtQueueId: true,
        store: { select: { name: true } },
        syncCursor: { select: { lastCommittedUid: true } },
      },
    }),

  createQueue: async (input) => {
    const result = await createQueue(input);
    return { ok: result.ok, id: numericId(result.data?.id) ?? undefined, error: result.error };
  },

  updateQueue: async (queueId, input) => {
    const result = await updateQueue(queueId, input);
    return { ok: result.ok, error: result.error };
  },

  findQueueByName: async (name) => {
    const result = await findQueueByName(name);
    return { ok: result.ok, id: result.data?.id ?? null, error: result.error };
  },

  disableQueue: async (queueId) => {
    await disableQueue(queueId);
  },

  ensureLabelsCustomField: async (queueId) => {
    const field = await findOrCreateGmailLabelsCustomField();
    const fieldId = numericId(field.data?.id);
    if (!field.ok || !fieldId) return { ok: false, error: field.error ?? "rt_custom_field_failed" };
    const attached = await attachCustomFieldToQueue(fieldId, queueId);
    return { ok: attached.ok, error: attached.error };
  },

  grantRights: async (queueId) => {
    const serviceResult = await grantQueueRights(
      queueId,
      { type: "User", name: SERVICE_PRINCIPAL },
      REQUIRED_QUEUE_RIGHTS,
    );
    if (!serviceResult.ok) return { ok: false, error: serviceResult.error };
    const mailgateResult = await grantQueueRights(
      queueId,
      { type: "Group", name: MAILGATE_PRINCIPAL },
      REQUIRED_QUEUE_RIGHTS,
    );
    return { ok: mailgateResult.ok, error: mailgateResult.error };
  },

  materialize: async (mailbox) => {
    await materializeRuntimeSecret(mailbox.id, DEFAULT_RUNTIME_DIR);
    await writeRuntimeMailboxConfig({
      mailboxId: mailbox.id,
      email: mailbox.email,
      initialSyncAfter: mailbox.initialSyncAfter,
      lastCommittedUid: mailbox.syncCursor?.lastCommittedUid ?? BigInt(0),
    }, DEFAULT_RUNTIME_DIR);
  },

  markActive: (mailboxId, queueId) =>
    prisma.mailbox.update({
      where: { id: mailboxId },
      data: { rtQueueId: queueId, syncStatus: "ACTIVE", lastSyncErrorCode: null },
    }).then(() => undefined),

  markDegraded: async (mailboxId, code) => {
    await Promise.all([
      removeRuntimeSecret(mailboxId, DEFAULT_RUNTIME_DIR).catch(() => undefined),
      removeRuntimeMailboxConfigs(mailboxId, DEFAULT_RUNTIME_DIR).catch(() => undefined),
    ]);
    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { syncStatus: "DEGRADED", lastSyncErrorCode: code },
    });
  },
};
