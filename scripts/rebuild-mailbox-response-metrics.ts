import "dotenv/config";
import { prisma } from "../src/lib/db";
import { enqueueMailboxResponseMetricsRebuild } from "../src/lib/mailboxes/queue";
import { mailboxResponseMetrics } from "../src/lib/mailboxes/response-metrics";

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has("--write");
  const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant-id="));
  const mailboxArg = process.argv.find((arg) => arg.startsWith("--mailbox-id="));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const minArticlesArg = process.argv.find((arg) => arg.startsWith("--min-articles="));
  const progressEveryArg = process.argv.find((arg) => arg.startsWith("--progress-every="));
  const batchSizeArg = process.argv.find((arg) => arg.startsWith("--batch-size="));
  const limit = limitArg ? Number.parseInt(limitArg.slice("--limit=".length), 10) : undefined;
  const minArticles = minArticlesArg ? Number.parseInt(minArticlesArg.slice("--min-articles=".length), 10) : undefined;
  const progressEvery = progressEveryArg ? Number.parseInt(progressEveryArg.slice("--progress-every=".length), 10) : undefined;
  const batchSize = batchSizeArg ? Number.parseInt(batchSizeArg.slice("--batch-size=".length), 10) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("limit must be a positive integer");
  }
  if (minArticles !== undefined && (!Number.isInteger(minArticles) || minArticles < 1)) {
    throw new Error("min-articles must be a positive integer");
  }
  if (progressEvery !== undefined && (!Number.isInteger(progressEvery) || progressEvery < 1)) {
    throw new Error("progress-every must be a positive integer");
  }
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    throw new Error("batch-size must be a positive integer");
  }
  if (args.has("--queue")) {
    if (!write) throw new Error("--queue requires --write");
    const job = await enqueueMailboxResponseMetricsRebuild({
      tenantId: tenantArg?.slice("--tenant-id=".length),
      mailboxId: mailboxArg?.slice("--mailbox-id=".length),
      batchSize,
      minArticles,
      onlyMissingDuration: args.has("--only-missing-duration"),
      repliedOnly: args.has("--replied-only"),
      dryRun: false,
    });
    console.log(JSON.stringify({ mode: "queue", jobId: job.id }, null, 2));
    return;
  }
  const result = await mailboxResponseMetrics.rebuild({
    tenantId: tenantArg?.slice("--tenant-id=".length),
    mailboxId: mailboxArg?.slice("--mailbox-id=".length),
    limit,
    batchSize,
    minArticles,
    onlyMissingDuration: args.has("--only-missing-duration"),
    repliedOnly: args.has("--replied-only"),
    progressEvery,
    dryRun: !write,
  });
  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", ...result }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "rebuild_mailbox_response_metrics_failed");
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
