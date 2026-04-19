import { Readable } from "node:stream";

/**
 * Storage provider interface — abstracts file storage
 * v1: local disk, v2: S3/R2
 */
export interface StorageProvider {
  /**
   * Save a readable stream to storage
   */
  putStream(key: string, stream: Readable, mime: string): Promise<void>;

  /**
   * Save a buffer to storage
   */
  putBuffer(key: string, buffer: Buffer, mime: string): Promise<void>;

  /**
   * Get public URL for a file
   */
  getPublicUrl(key: string): string;

  /**
   * Delete a file
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists
   */
  exists(key: string): Promise<boolean>;
}
