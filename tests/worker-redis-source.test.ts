import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("worker fails fast when Redis is read-only", () => {
  const source = readFileSync("start-worker.ts", "utf8");

  assert.match(source, /assertRedisWritable/);
  assert.match(source, /redis\.set\(key,\s*"1",\s*"PX",\s*10_000\)/);
  assert.match(source, /READONLY/);
  assert.match(source, /writable Redis primary/);
});

test("mailbox worker fails fast when Redis is read-only", () => {
  const source = readFileSync("start-mailbox-worker.ts", "utf8");

  assert.match(source, /assertRedisWritable/);
  assert.match(source, /redis\.set\(key,\s*"1",\s*"PX",\s*10_000\)/);
  assert.match(source, /READONLY/);
  assert.match(source, /writable Redis primary/);
});
