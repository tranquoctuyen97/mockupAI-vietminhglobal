import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { mkdir, unlink, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { StorageProvider } from "./types";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

/**
 * Local disk storage provider
 * Stores files under UPLOAD_DIR with subdirectories
 */
export class LocalDiskStorage implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || UPLOAD_DIR;
  }

  async putStream(key: string, stream: Readable): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    const writeStream = createWriteStream(filePath);
    await pipeline(stream, writeStream);
  }

  async putBuffer(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await mkdir(dirname(filePath), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, buffer);
  }

  getPublicUrl(key: string): string {
    // In dev: serve via API route; in prod: Nginx /media/
    return `/api/files/${key}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Get absolute path for a key */
  resolvePath(key: string): string {
    return join(this.baseDir, key);
  }
}

/** Singleton instance */
let _storage: LocalDiskStorage | null = null;

export function getStorage(): LocalDiskStorage {
  if (!_storage) {
    _storage = new LocalDiskStorage();
  }
  return _storage;
}
