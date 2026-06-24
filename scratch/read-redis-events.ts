import Redis from "ioredis";

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  console.log("Connecting to Redis:", redisUrl);
  const redis = new Redis(redisUrl);

  const streamKey = "bull:mockup-composite-queue:events";
  console.log(`Reading last 100 events from stream: ${streamKey}`);

  // XRANGE key - + count 100
  const events = await redis.xrevrange(streamKey, "+", "-", "COUNT", "100");
  console.log(`Found ${events.length} events:`);

  for (const [id, fields] of events) {
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }
    console.log(`- Event ID: ${id}`);
    console.log(`  Event: ${JSON.stringify(data, null, 2)}`);
  }

  await redis.quit();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
