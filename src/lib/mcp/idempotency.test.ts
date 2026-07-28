import assert from "node:assert/strict";
import test from "node:test";
import { createIdempotencyService, IdempotencyError } from "./idempotency";

function harness() {
  const records = new Map<string, any>();
  const keyFor = (input: { profileId: string; toolName: string; idempotencyKey: string }) =>
    `${input.profileId}:${input.toolName}:${input.idempotencyKey}`;

  return createIdempotencyService({
    find: async (input) => records.get(keyFor(input)) ?? null,
    create: async (input) => {
      const key = keyFor(input);
      if (records.has(key)) throw new Error("UNIQUE_CONFLICT");
      const record = {
        id: `record_${records.size + 1}`,
        ...input,
        status: "IN_PROGRESS",
        response: null,
      };
      records.set(key, record);
      return record;
    },
    succeed: async (id, response) => {
      const record = [...records.values()].find((item) => item.id === id);
      record.status = "SUCCEEDED";
      record.response = response;
    },
    remove: async (id) => {
      const entry = [...records.entries()].find(([, value]) => value.id === id);
      if (entry) records.delete(entry[0]);
    },
    isUniqueConflict: (error) => error instanceof Error && error.message === "UNIQUE_CONFLICT",
  });
}

test("replays the first successful response without calling handler twice", async () => {
  const service = harness();
  let handlerCalls = 0;
  const input = {
    profileId: "profile_1",
    toolName: "set_wizard_content",
    idempotencyKey: "idem_1",
    normalizedRequest: { draftId: "draft_1", title: "Title" },
  };
  const handler = async () => {
    handlerCalls += 1;
    return { ok: true, data: { saved: true } };
  };

  const first = await service.runIdempotent(input, handler);
  const replay = await service.runIdempotent(input, handler);
  assert.deepEqual(replay, first);
  assert.equal(handlerCalls, 1);
});

test("same key with a different canonical request conflicts", async () => {
  const service = harness();
  const input = {
    profileId: "profile_1",
    toolName: "set_wizard_content",
    idempotencyKey: "idem_1",
    normalizedRequest: { b: 2, a: 1 },
  };
  await service.runIdempotent(input, async () => ({ ok: true }));

  await assert.rejects(
    () =>
      service.runIdempotent({ ...input, normalizedRequest: { different: true } }, async () => ({
        ok: false,
      })),
    (error: unknown) => error instanceof IdempotencyError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("canonical object key order hashes to the same request", async () => {
  const service = harness();
  const first = await service.runIdempotent(
    {
      profileId: "profile_1",
      toolName: "tool",
      idempotencyKey: "idem",
      normalizedRequest: { b: 2, a: { d: 4, c: 3 } },
    },
    async () => ({ ok: true }),
  );
  const replay = await service.runIdempotent(
    {
      profileId: "profile_1",
      toolName: "tool",
      idempotencyKey: "idem",
      normalizedRequest: { a: { c: 3, d: 4 }, b: 2 },
    },
    async () => ({ ok: false }),
  );
  assert.deepEqual(replay, first);
});
