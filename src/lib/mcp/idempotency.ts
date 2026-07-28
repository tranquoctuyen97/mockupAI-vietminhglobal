import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

type IdempotencyLookup = {
  profileId: string;
  toolName: string;
  idempotencyKey: string;
};

type IdempotencyRecord = IdempotencyLookup & {
  id: string;
  requestHash: string;
  status: string;
  response: unknown;
  expiresAt: Date;
};

type IdempotencyDependencies = {
  find(input: IdempotencyLookup): Promise<IdempotencyRecord | null>;
  create(
    input: IdempotencyLookup & {
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<IdempotencyRecord>;
  succeed(id: string, response: unknown): Promise<void>;
  remove(id: string): Promise<void>;
  isUniqueConflict(error: unknown): boolean;
};

export class IdempotencyError extends Error {
  constructor(
    public readonly code: "IDEMPOTENCY_CONFLICT" | "IDEMPOTENCY_IN_PROGRESS",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "IdempotencyError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, canonicalize(source[key])]),
    );
  }
  return value;
}

export function hashNormalizedRequest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function createIdempotencyService(deps: IdempotencyDependencies) {
  async function resolveExisting<T>(existing: IdempotencyRecord, requestHash: string): Promise<T> {
    if (existing.expiresAt.getTime() <= Date.now()) {
      await deps.remove(existing.id);
      throw new IdempotencyError(
        "IDEMPOTENCY_IN_PROGRESS",
        "Expired idempotency record was cleared; retry the request",
        true,
      );
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyError(
        "IDEMPOTENCY_CONFLICT",
        "IDEMPOTENCY_CONFLICT: key was already used for a different request",
        false,
      );
    }
    if (existing.status === "SUCCEEDED") {
      return existing.response as T;
    }
    throw new IdempotencyError(
      "IDEMPOTENCY_IN_PROGRESS",
      "Idempotent operation is still in progress",
      true,
    );
  }

  async function runIdempotent<T>(
    input: IdempotencyLookup & { normalizedRequest: unknown },
    handler: () => Promise<T>,
  ): Promise<T> {
    const lookup = {
      profileId: input.profileId,
      toolName: input.toolName,
      idempotencyKey: input.idempotencyKey,
    };
    const requestHash = hashNormalizedRequest(input.normalizedRequest);
    const existing = await deps.find(lookup);
    if (existing) {
      if (existing.expiresAt.getTime() <= Date.now()) {
        await deps.remove(existing.id);
      } else {
        return resolveExisting<T>(existing, requestHash);
      }
    }

    let record: IdempotencyRecord;
    try {
      record = await deps.create({
        ...lookup,
        requestHash,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
    } catch (error) {
      if (!deps.isUniqueConflict(error)) throw error;
      const winner = await deps.find(lookup);
      if (!winner) throw error;
      return resolveExisting<T>(winner, requestHash);
    }

    try {
      const response = await handler();
      await deps.succeed(record.id, response);
      return response;
    } catch (error) {
      await deps.remove(record.id);
      throw error;
    }
  }

  return { runIdempotent };
}

const idempotencyService = createIdempotencyService({
  find: (input) =>
    prisma.mcpIdempotencyRecord.findUnique({
      where: {
        profileId_toolName_idempotencyKey: input,
      },
    }),
  create: (input) =>
    prisma.mcpIdempotencyRecord.create({
      data: input,
    }),
  succeed: async (id, response) => {
    await prisma.mcpIdempotencyRecord.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        response: response as Prisma.InputJsonValue,
      },
    });
  },
  remove: async (id) => {
    await prisma.mcpIdempotencyRecord.deleteMany({ where: { id } });
  },
  isUniqueConflict: (error) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "P2002",
});

export const runIdempotent = idempotencyService.runIdempotent;
