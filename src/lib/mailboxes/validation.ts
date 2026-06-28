import { z } from "zod";

const id = z.string().trim().min(1);
const name = z.string().trim().min(1).max(200);
const appPassword = z.string().min(1).max(256);

export const createMailboxSchema = z.object({
  storeId: id,
  name,
  email: z.string().trim().email(),
  fromName: name.optional(),
  appPassword,
}).strict();

export const updateMailboxSchema = z.object({
  name: name.optional(),
  fromName: name.optional(),
  appPassword: appPassword.optional(),
}).strict();

export const toggleMailboxStatusSchema = z.object({
  active: z.boolean(),
}).strict();

export const testMailboxConnectionSchema = z.object({
  probe: z.literal(true).optional(),
  email: z.string().trim().email(),
  password: appPassword,
}).strict();

export const createLabelSchema = z.object({ storeId: id, mailboxId: id, name }).strict();
export const renameLabelSchema = z.object({ storeId: id, mailboxId: id, name }).strict();
export const replaceConversationLabelsSchema = z.object({
  storeId: id,
  mailboxId: id,
  labelIds: z.array(id).max(500),
}).strict();
export const replySchema = z.object({
  text: z.string().trim().min(1).max(50_000),
  attachmentIds: z.array(id).max(10).optional(),
}).strict();
export const internalNoteSchema = z.object({
  text: z.string().trim().min(1).max(50_000),
}).strict();
export const statusSchema = z.object({ status: z.enum(["active", "pending", "closed"]) }).strict();

export type CreateMailboxInput = z.infer<typeof createMailboxSchema>;
export type UpdateMailboxInput = z.infer<typeof updateMailboxSchema>;
export type TestMailboxConnectionInput = z.infer<typeof testMailboxConnectionSchema>;
