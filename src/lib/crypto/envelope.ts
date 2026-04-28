/**
 * Envelope Encryption using AES-256-GCM (Node.js built-in crypto)
 *
 * Format: iv (12 bytes) + authTag (16 bytes) + ciphertext
 * Key: 32-byte hex string from MASTER_ENCRYPTION_KEY env
 * KeyId: tracks key version for rotation support
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("MASTER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

function getKeyId(): string {
  const keyId = process.env.MASTER_ENCRYPTION_KEY_ID;
  if (!keyId) {
    throw new Error("MASTER_ENCRYPTION_KEY_ID is required");
  }
  return keyId;
}

/**
 * Encrypt plaintext → packed Buffer (iv + tag + ciphertext)
 */
export function encrypt(plaintext: string): { encrypted: Uint8Array<ArrayBuffer>; keyId: string } {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + authTag (16) + ciphertext (N)
  const packed = Buffer.concat([iv, authTag, encrypted]);

  // Return as Uint8Array backed by a proper ArrayBuffer (Prisma Bytes compat)
  const result = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
  return { encrypted: result, keyId: getKeyId() };
}

/**
 * Decrypt packed Buffer → plaintext string
 */
export function decrypt(packed: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(packed) ? packed : Buffer.from(packed);
  const key = getMasterKey();

  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted data: too short");
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
