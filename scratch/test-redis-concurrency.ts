import { Queue } from "bullmq";
import { redisConnection } from "../src/lib/queue/queue";
import { MOCKUP_QUEUE_NAME } from "../src/lib/mockup/queue";

async function main() {
  console.log("Simulating batch enqueueing...");
  
  // Re-create the same queue creation logic
  const mockupQueue = new Queue(MOCKUP_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  try {
    console.log("Adding Job A...");
    const jobA = await mockupQueue.add("test-job-a", { id: "A" });
    console.log(`Job A added successfully! ID: ${jobA.id}`);
  } catch (error) {
    console.error("Job A failed to enqueue:", error);
  }

  try {
    console.log("Adding Job B...");
    const jobB = await mockupQueue.add("test-job-b", { id: "B" });
    console.log(`Job B added successfully! ID: ${jobB.id}`);
  } catch (error) {
    console.error("Job B failed to enqueue:", error);
  }

  await mockupQueue.close();
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
