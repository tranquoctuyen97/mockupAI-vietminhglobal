/**
 * Zod validation schemas for admin mailbox management.
 *
 * Rules:
 * - Passwords required on create, optional on update (blank = keep existing)
 * - Extra fields rejected via z.object().strict()
 * - Port range 1-65535
 * - Encryption enum: ssl | starttls | none
 * - Provider enum: gmail | custom
 */
import { z } from "zod";

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const inboundCreateSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535, "Port must be 1-65535"),
  encryption: z.enum(["ssl", "starttls", "none"]),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  folder: z.string().optional().default("inbox"),
}).strict();

const outboundCreateSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535, "Port must be 1-65535"),
  encryption: z.enum(["ssl", "starttls", "none"]),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
}).strict();

const inboundUpdateSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535, "Port must be 1-65535"),
  encryption: z.enum(["ssl", "starttls", "none"]),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional(), // blank = keep existing
  folder: z.string().optional().default("inbox"),
}).strict();

const outboundUpdateSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535, "Port must be 1-65535"),
  encryption: z.enum(["ssl", "starttls", "none"]),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional(), // blank = keep existing
}).strict();

const assignmentSchema = z.object({
  userId: z.string().min(1),
  canReply: z.boolean(),
  canUpdateStatus: z.boolean(),
}).strict();

// ─── CREATE ─────────────────────────────────────────────────────────────────

export const MAILBOX_HISTORY_WINDOW_MONTHS = 6;

export const createMailboxSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email"),
  provider: z.enum(["gmail", "custom"]),
  fromName: z.string().min(1).max(200).optional(),
  // Gmail mode: only appPassword needed (probe auto-detects settings)
  appPassword: z.string().min(1).optional(),
  // Custom mode: full inbound/outbound required
  inbound: inboundCreateSchema.optional(),
  outbound: outboundCreateSchema.optional(),
}).strict().refine(
  (d) => {
    if (d.provider === "gmail") return !!d.appPassword;
    return !!d.inbound && !!d.outbound;
  },
  "Gmail requires appPassword; Custom requires inbound + outbound",
);

export type CreateMailboxInput = z.infer<typeof createMailboxSchema>;

// ─── UPDATE ─────────────────────────────────────────────────────────────────

export const updateMailboxSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  fromName: z.string().min(1).max(200).optional(),
  inbound: inboundUpdateSchema.optional(),
  outbound: outboundUpdateSchema.optional(),
}).strict();

export type UpdateMailboxInput = z.infer<typeof updateMailboxSchema>;

// ─── STATUS ─────────────────────────────────────────────────────────────────

export const statusSchema = z.object({
  active: z.boolean(),
}).strict();

// ─── ASSIGNMENTS ────────────────────────────────────────────────────────────

export const assignmentsSchema = z.object({
  assignments: z.array(assignmentSchema),
}).strict();

export type AssignmentsInput = z.infer<typeof assignmentsSchema>;

// ─── TEST CONNECTION ────────────────────────────────────────────────────────

export const testConnectionSchema = z.object({
  inbound: inboundCreateSchema.optional(),
  outbound: outboundCreateSchema.extend({
    email: z.string().email(),
  }).strict().optional(),
}).strict().refine(
  (d) => d.inbound || d.outbound,
  "Must test at least inbound or outbound",
);

// ─── PROBE ──────────────────────────────────────────────────────────────────

export const probeSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict();

// ─── Encryption mapping helpers ─────────────────────────────────────────────

/**
 * Map app encryption value to Zammad inbound SSL value.
 * - "ssl"      → "ssl"
 * - "starttls" → "starttls"
 * - "none"     → false (as string "false" for Zammad inbound)
 */
export function toZammadInboundSsl(encryption: string): string {
  if (encryption === "ssl" || encryption === "starttls") return encryption;
  return "false";
}

/**
 * Map app encryption value to Zammad outbound SSL boolean.
 * - "ssl"      → true
 * - "starttls" → true
 * - "none"     → false
 */
export function toZammadOutboundSsl(encryption: string): boolean {
  // "ssl" (port 465) → true: implicit TLS
  // "starttls" (port 587) → false: Zammad auto enable_starttls_auto
  // "none" → false
  return encryption === "ssl";
}
