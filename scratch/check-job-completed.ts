import { prisma } from "../src/lib/db";

async function main() {
  const jobId = "cmqqt6gv100004wt0earfzc8l";
  const job = await prisma.mockupJob.findUnique({
    where: { id: jobId },
    include: { images: true }
  });

  console.log("Job status:", job?.status);
  console.log("Image status:", job?.images[0]?.compositeStatus);
  console.log("Image compositeUrl:", job?.images[0]?.compositeUrl);
  console.log("Image compositeError:", job?.images[0]?.compositeError);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
