import { hash, verify } from "argon2";

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64MB
  timeCost: 3,
  parallelism: 1,
  type: 2 as const, // argon2id
};

/**
 * Hash a plaintext password using argon2id
 * Memory: 64MB, iterations: 3, parallelism: 1
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against an argon2id hash
 */
export async function verifyPassword(
  hashedPassword: string,
  plainPassword: string,
): Promise<boolean> {
  try {
    return await verify(hashedPassword, plainPassword);
  } catch {
    return false;
  }
}
