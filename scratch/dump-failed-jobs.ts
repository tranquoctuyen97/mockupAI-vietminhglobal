import { Queue } from "bullmq";
import { redisConnection } from "../src/lib/queue/queue";
import { MOCKUP_QUEUE_NAME } from "../src/lib/mockup/queue";

async function main() {
  console.log("Checking failed jobs in mockup-composite-queue...");
  const mockupQueue = new Queue(MOCKUP_QUEUE_NAME, { connection: redisConnection });

  const failedJobs = await mockupQueue.getFailed();
  console.log(`Found ${failedJobs.length} failed jobs:`);
  
  for (const job of failedJobs) {
    console.log(`\n- Job ID: ${job.id}`);
    console.log(`  Name: ${job.name}`);
    console.log(`  Data: ${JSON.stringify(job.data, null, 2)}`);
    console.log(`  Failed Reason: ${job.failedReason}`);
    console.log(`  Attempts: ${job.attemptsMade}`);
    if (job.stacktrace && job.stacktrace.length > 0) {
      console.log(`  Stacktrace:\n${job.stacktrace.join("\n")}`);
    }
  }

  await mockupQueue.close();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
