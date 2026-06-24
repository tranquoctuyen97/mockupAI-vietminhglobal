import Redis from "ioredis";

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(redisUrl);

  const keys = await redis.keys("bull:mockup-composite-queue:*");
  console.log(`Found ${keys.length} keys:`);

  // Let's find keys that look like bull:mockup-composite-queue:<jobId> (where jobId is a number)
  const jobKeys = keys.filter(k => /^bull:mockup-composite-queue:\d+$/.test(k));
  console.log(`Found ${jobKeys.length} job keys:`);

  for (const key of jobKeys.sort()) {
    const data = await redis.hgetall(key);
    console.log(`Key: ${key}`);
    console.log(`  name: ${data.name}`);
    try {
      const parsedData = JSON.parse(data.data || "{}");
      console.log(`  data:`, JSON.stringify(parsedData, null, 2));
    } catch {
      console.log(`  data: ${data.data}`);
    }
    console.log(`  opts: ${data.opts}`);
    console.log(`  failedReason: ${data.failedReason}`);
  }

  await redis.quit();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
