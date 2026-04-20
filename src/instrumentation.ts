/**
 * Next.js Instrumentation Hook
 * Runs once when the server starts (both dev and prod).
 * Used to initialize BullMQ workers so they're ready before any requests.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startHealthCheckWorker } = await import(
      "@/lib/queue/workers/health-check-worker"
    );
    const { startMockupWorker } = await import(
      "@/lib/queue/workers/mockup-worker"
    );

    try {
      startHealthCheckWorker();
      startMockupWorker();
      console.log("[Instrumentation] BullMQ workers started.");
    } catch (err) {
      // Don't crash the server if Redis is temporarily unavailable
      console.error("[Instrumentation] Worker startup error (Redis down?):", err);
    }
  }
}
