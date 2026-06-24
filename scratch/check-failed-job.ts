import { Queue } from "bullmq";
import { redisConnection } from "../src/lib/queue/queue";
import { MOCKUP_QUEUE_NAME } from "../src/lib/mockup/queue";

async function main() {
  const mockupQueue = new Queue(MOCKUP_QUEUE_NAME, { connection: redisConnection });

  // Get active/completed/failed jobs
  const jobs = await mockupQueue.getJobs(["active", "wait", "failed", "completed"]);
  console.log(`Found ${jobs.length} jobs in queue:`);
  for (const job of jobs) {
    console.log(`Job ID: ${job.id}`);
    console.log(`  Name: ${job.name}`);
    console.log(`  Data:`, JSON.stringify(job.data, null, 2));
    if (job.failedReason) {
      console.log(`  Failed Reason: ${job.failedReason}`);
    }
  }

  await mockupQueue.close();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
