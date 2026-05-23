import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { LocalDiskStorage } from "./local-disk.js";

test("LocalDiskStorage getBuffer returns stored file contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "local-disk-storage-"));
  try {
    const storage = new LocalDiskStorage(dir);
    await storage.putBuffer("nested/file.txt", Buffer.from("hello"), "text/plain");
    const buffer = await storage.getBuffer("nested/file.txt");
    assert.equal(buffer.toString("utf8"), "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LocalDiskStorage getBuffer throws for missing files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "local-disk-storage-"));
  try {
    const storage = new LocalDiskStorage(dir);
    await assert.rejects(() => storage.getBuffer("missing.txt"), /not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
