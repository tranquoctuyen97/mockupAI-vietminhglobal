import Redis from "ioredis";

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const redis = new Redis(redisUrl);

  for (const id of ["96", "97"]) {
    const job = await redis.hgetall(`bull:mockup-composite-queue:${id}`);
    console.log(`\nJob ID: ${id}`);
    console.log("Job data:", job.data);
    console.log("Job opts:", job.opts);
    console.log("Job failedReason:", job.failedReason);
  }

  await redis.quit();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
