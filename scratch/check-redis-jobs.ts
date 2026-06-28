import { Queue } from "bullmq";
import { redisConnection } from "../src/lib/queue/queue";
import { MOCKUP_QUEUE_NAME } from "../src/lib/mockup/queue";

async function main() {
  const mockupQueue = new Queue(MOCKUP_QUEUE_NAME, { connection: redisConnection });

  console.log("Checking job IDs from 70 to 95 in BullMQ...");
  for (let id = 70; id <= 95; id++) {
    const job = await mockupQueue.getJob(String(id));
    if (job) {
      const state = await job.getState();
      console.log(`Job ID: ${id}`);
      console.log(`  Name: ${job.name}`);
      console.log(`  State: ${state}`);
      console.log(`  Data: ${JSON.stringify(job.data)}`);
      if (job.failedReason) console.log(`  Failed Reason: ${job.failedReason}`);
      if (job.finishedOn) console.log(`  Finished On: ${new Date(job.finishedOn).toISOString()}`);
    } else {
      console.log(`Job ID: ${id} - NOT FOUND`);
    }
  }

  await mockupQueue.close();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
