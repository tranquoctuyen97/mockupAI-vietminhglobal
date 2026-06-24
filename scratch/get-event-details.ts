import Redis from "ioredis";

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(redisUrl);

  const streamKey = "bull:mockup-composite-queue:events";
  const events = await redis.xrevrange(streamKey, "+", "-", "COUNT", "100");

  for (const [id, fields] of events) {
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }
    if (data.jobId === "96" || data.jobId === "97") {
      console.log(`Event ID: ${id}, Event: ${data.event}, Job ID: ${data.jobId}`);
      if (data.returnvalue) console.log(`  ReturnValue: ${data.returnvalue}`);
    }
  }

  await redis.quit();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
