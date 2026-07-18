/**
 * POST /api/listings/:id/retry-printify — Retry publish through durable outbox
 */

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type RetryListing = {
  id: string;
  tenantId: string;
  status: string;
  wizardDraftId: string | null;
  activePublishAttemptId: string | null;
  shopifyProductId: string | null;
  printifyProductId: string | null;
  publishAttempts: Array<{ id: string; attemptNo: number }>;
  publishJobs: Array<{
    stage: "SHOPIFY" | "PRINTIFY";
    status: string;
    publishAttemptId: string | null;
  }>;
};

function nextAttemptNo(listing: RetryListing): number {
  if (listing.publishAttempts.length === 0) return 1;
  return Math.max(...listing.publishAttempts.map((attempt) => attempt.attemptNo)) + 1;
}

function shouldCarryForwardStage(input: {
  listing: RetryListing;
  stage: "SHOPIFY" | "PRINTIFY";
}): boolean {
  const previousJob = input.listing.publishJobs.find((job) => job.stage === input.stage);
  if (previousJob?.status !== "SUCCEEDED") return false;
  if (input.stage === "SHOPIFY") return Boolean(input.listing.shopifyProductId);
  return Boolean(input.listing.printifyProductId);
}

function resumedFromAttemptId(listing: RetryListing): string | null {
  return (
    listing.publishJobs.find(
      (job) =>
        job.status === "SUCCEEDED" &&
        (job.stage === "SHOPIFY" ? listing.shopifyProductId : listing.printifyProductId),
    )?.publishAttemptId ?? null
  );
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${session.tenantId}), hashtext(${id}))`,
    );

    const listing = (await tx.listing.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        publishAttempts: { select: { id: true, attemptNo: true } },
        publishJobs: {
          select: { stage: true, status: true, publishAttemptId: true },
          orderBy: { createdAt: "desc" },
        },
      },
    })) as RetryListing | null;

    if (!listing) {
      return { response: NextResponse.json({ error: "Listing not found" }, { status: 404 }) };
    }

    if (!["PARTIAL_FAILURE", "FAILED"].includes(listing.status)) {
      return {
        response: NextResponse.json(
          {
            error: `Listing status is ${listing.status}. Retry only allowed for PARTIAL_FAILURE or FAILED.`,
          },
          { status: 400 },
        ),
      };
    }

    if (!listing.wizardDraftId) {
      return { response: NextResponse.json({ error: "Draft not found" }, { status: 400 }) };
    }

    if (listing.activePublishAttemptId) {
      return {
        response: NextResponse.json({
          ok: true,
          status: "already_running",
          publishAttemptId: listing.activePublishAttemptId,
        }),
      };
    }

    const shopifyStatus = shouldCarryForwardStage({ listing, stage: "SHOPIFY" })
      ? "SUCCEEDED"
      : "PENDING";
    const printifyStatus = shouldCarryForwardStage({ listing, stage: "PRINTIFY" })
      ? "SUCCEEDED"
      : "PENDING";
    const resumeFromAttemptId = resumedFromAttemptId(listing);
    const attempt = await tx.publishAttempt.create({
      data: {
        listingId: listing.id,
        tenantId: session.tenantId,
        attemptNo: nextAttemptNo(listing),
        status: "PENDING",
        baselineListingStatus: listing.status,
        resumeFromAttemptId,
      },
    });

    await tx.publishJob.createMany({
      data: [
        {
          listingId: listing.id,
          publishAttemptId: attempt.id,
          idempotencyKey: `${listing.id}:${attempt.id}:SHOPIFY`,
          stage: "SHOPIFY",
          status: shopifyStatus,
          completedAt: shopifyStatus === "SUCCEEDED" ? new Date() : null,
          progressData: resumeFromAttemptId
            ? { resumedFromAttemptId: resumeFromAttemptId }
            : Prisma.DbNull,
        },
        {
          listingId: listing.id,
          publishAttemptId: attempt.id,
          idempotencyKey: `${listing.id}:${attempt.id}:PRINTIFY`,
          stage: "PRINTIFY",
          status: printifyStatus,
          completedAt: printifyStatus === "SUCCEEDED" ? new Date() : null,
          progressData: resumeFromAttemptId
            ? { resumedFromAttemptId: resumeFromAttemptId }
            : Prisma.DbNull,
        },
      ],
    });

    await tx.publishOutbox.create({
      data: {
        listingId: listing.id,
        draftId: listing.wizardDraftId,
        tenantId: session.tenantId,
        publishAttemptId: attempt.id,
      },
    });

    await tx.listing.update({
      where: { id: listing.id },
      data: {
        status: "PUBLISHING",
        activePublishAttemptId: attempt.id,
      },
    });

    return {
      response: NextResponse.json({
        ok: true,
        status:
          shopifyStatus === "SUCCEEDED" || printifyStatus === "SUCCEEDED" ? "resuming" : "retrying",
        publishAttemptId: attempt.id,
        resumedFromAttemptId: resumeFromAttemptId,
      }),
    };
  });

  return result.response;
}
