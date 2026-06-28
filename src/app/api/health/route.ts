import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getGmailLabelOperationsQueue, getMailboxSyncQueue } from "@/lib/queue/queue";
import { rtRequest } from "@/lib/rt/client";

export async function GET() {
  try {
    // Check DB connection
    await prisma.$queryRaw`SELECT 1`;
    const [mailboxAggregate, oldestSync, queueHealth, rtHealth] = await Promise.all([
      prisma.mailbox.groupBy({
        by: ["syncStatus"],
        _count: { _all: true },
      }),
      prisma.mailbox.findFirst({
        where: { isActive: true, lastSyncAt: { not: null } },
        orderBy: { lastSyncAt: "asc" },
        select: { lastSyncAt: true },
      }),
      checkMailboxQueues(),
      checkRt(),
    ]);
    const activeCount = mailboxAggregate
      .filter((row) => row.syncStatus === "ACTIVE" || row.syncStatus === "PROVISIONING")
      .reduce((sum, row) => sum + row._count._all, 0);
    const degradedCount = mailboxAggregate
      .filter((row) => row.syncStatus === "DEGRADED")
      .reduce((sum, row) => sum + row._count._all, 0);

    return NextResponse.json({
      status: degradedCount > 0 || queueHealth !== "connected" || rtHealth !== "reachable" ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      services: {
        database: "connected",
        mailboxQueues: queueHealth,
        rtRest2: rtHealth,
      },
      mailboxes: {
        activeCount,
        degradedCount,
        oldestLastSyncAt: oldestSync?.lastSyncAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("[HEALTH] Check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        services: {
          database: "disconnected",
        },
      },
      { status: 503 },
    );
  }
}

async function checkMailboxQueues(): Promise<"connected" | "unavailable"> {
  try {
    await Promise.all([
      getMailboxSyncQueue().getJobCounts("waiting", "active", "delayed", "failed"),
      getGmailLabelOperationsQueue().getJobCounts("waiting", "active", "delayed", "failed"),
    ]);
    return "connected";
  } catch {
    return "unavailable";
  }
}

async function checkRt(): Promise<"reachable" | "unconfigured" | "unavailable"> {
  if (!process.env.RT_URL || !process.env.RT_API_TOKEN) return "unconfigured";
  try {
    const response = await rtRequest({ method: "GET", path: "/REST/2.0/rt", timeoutMs: 3_000 });
    return response.ok ? "reachable" : "unavailable";
  } catch {
    return "unavailable";
  }
}
