import Redis from "ioredis";
import { REDIS_URL } from "../src/lib/queue/queue"; // wait, let's see if we can import it or just use process.env

async function main() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  console.log("Connecting to Redis:", redisUrl);
  const redis = new Redis(redisUrl);

  const counterKeyComp = "bull:mockup-composite-queue:id";
  const counterKeyPoll = "bull:printify-mockup-poll-queue:id";

  const compId = await redis.get(counterKeyComp);
  const pollId = await redis.get(counterKeyPoll);

  console.log(`mockup-composite-queue ID counter: ${compId}`);
  console.log(`printify-mockup-poll-queue ID counter: ${pollId}`);

  // Get keys matching bull:*
  const keys = await redis.keys("bull:*");
  console.log(`\nFound ${keys.length} keys in Redis matching 'bull:*':`);
  for (const key of keys.sort()) {
    const type = await redis.type(key);
    let details = "";
    if (type === "string") {
      details = `val: ${await redis.get(key)}`;
    } else if (type === "list") {
      details = `len: ${await redis.llen(key)}`;
    } else if (type === "set") {
      details = `size: ${await redis.scard(key)}`;
    } else if (type === "zset") {
      details = `size: ${await redis.zcard(key)}`;
    } else if (type === "hash") {
      details = `fields: ${await redis.hlen(key)}`;
    }
    console.log(`- ${key} (${type}) ${details}`);
  }

  await redis.quit();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
