import { Queue } from "bullmq";
import { redisConnection } from "../src/lib/queue/queue";
import { MOCKUP_QUEUE_NAME, PRINTIFY_MOCKUP_QUEUE_NAME } from "../src/lib/mockup/queue";

async function main() {
  console.log("Checking BullMQ status...");
  
  const mockupQueue = new Queue(MOCKUP_QUEUE_NAME, { connection: redisConnection });
  const printifyQueue = new Queue(PRINTIFY_MOCKUP_QUEUE_NAME, { connection: redisConnection });

  for (const q of [mockupQueue, printifyQueue]) {
    const name = q.name;
    const [waiting, active, delayed, failed, completed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getDelayedCount(),
      q.getFailedCount(),
      q.getCompletedCount(),
    ]);

    console.log(`\nQueue: ${name}`);
    console.log(`  Waiting: ${waiting}`);
    console.log(`  Active: ${active}`);
    console.log(`  Delayed: ${delayed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Completed: ${completed}`);

    const activeJobs = await q.getActive();
    if (activeJobs.length > 0) {
      console.log("  Active Jobs:");
      activeJobs.forEach(job => {
        console.log(`    - Job ID: ${job.id}, Name: ${job.name}, Data: ${JSON.stringify(job.data)}`);
      });
    }

    const failedJobs = await q.getFailed();
    if (failedJobs.length > 0) {
      console.log("  Failed Jobs:");
      failedJobs.slice(0, 5).forEach(job => {
        console.log(`    - Job ID: ${job.id}, Name: ${job.name}, Failed Reason: ${job.failedReason}`);
      });
    }

    const waitingJobs = await q.getWaiting();
    if (waitingJobs.length > 0) {
      console.log("  Waiting Jobs:");
      waitingJobs.slice(0, 5).forEach(job => {
        console.log(`    - Job ID: ${job.id}, Name: ${job.name}, Data: ${JSON.stringify(job.data)}`);
      });
    }
  }

  await mockupQueue.close();
  await printifyQueue.close();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
