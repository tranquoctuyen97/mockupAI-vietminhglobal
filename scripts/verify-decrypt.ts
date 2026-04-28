// Verify Shopify token decrypt issue
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "../src/lib/crypto/envelope";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const creds = await prisma.storeCredentials.findFirst({
    where: { shopifyTokenEncrypted: { not: null } },
  });

  if (!creds) {
    console.log("❌ No store credentials found");
    return;
  }

  console.log("Store ID:", creds.storeId);
  console.log("DB encryption_key_id:", creds.encryptionKeyId);
  console.log("ENV MASTER_ENCRYPTION_KEY_ID:", process.env.MASTER_ENCRYPTION_KEY_ID);
  console.log("ENV MASTER_ENCRYPTION_KEY length:", process.env.MASTER_ENCRYPTION_KEY?.length);
  console.log("Keys match:", creds.encryptionKeyId === process.env.MASTER_ENCRYPTION_KEY_ID);

  const buf = Buffer.from(creds.shopifyTokenEncrypted!);
  console.log("\nToken Buffer length:", buf.length);
  console.log("Is Uint8Array:", creds.shopifyTokenEncrypted instanceof Uint8Array);
  console.log("Is Buffer:", Buffer.isBuffer(creds.shopifyTokenEncrypted));

  // Test: encrypt something and check the result type
  const testResult = encrypt("test-token-123");
  console.log("\nFresh encrypt result type:", testResult.encrypted.constructor.name);
  console.log("Fresh encrypt length:", testResult.encrypted.length);

  // Verify fresh encrypt/decrypt roundtrip works
  try {
    const roundtrip = decrypt(testResult.encrypted);
    console.log("✅ Fresh roundtrip:", roundtrip === "test-token-123" ? "PASS" : "FAIL");
  } catch (err: any) {
    console.error("❌ Fresh roundtrip FAILED:", err.message);
  }

  // Now try decrypting the stored token
  try {
    const token = decrypt(creds.shopifyTokenEncrypted!);
    console.log("\n✅ Token decrypt OK, length:", token.length);
  } catch (err: any) {
    console.error("\n❌ Token decrypt FAILED:", err.message);
    console.error("   → This means the MASTER_ENCRYPTION_KEY changed after the token was encrypted.");
    console.error("   → Solution: Re-auth Shopify to get a new token and re-encrypt.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
