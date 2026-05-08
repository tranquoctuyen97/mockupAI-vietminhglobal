import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isTerminalMockupJobStatus } from "@/lib/mockup/job-sync";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await validateSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const job = await prisma.mockupJob.findUnique({
    where: { id },
    include: {
      images: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  });

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const isFinished = job.totalImages > 0 && job.completedImages + job.failedImages >= job.totalImages;
  
  if (isFinished && !isTerminalMockupJobStatus(job.status)) {
    await prisma.mockupJob.update({
      where: { id },
      data: { status: job.failedImages > 0 ? "failed" : "completed" }
    });
    job.status = job.failedImages > 0 ? "failed" : "completed";
  }

  return NextResponse.json(job);
}
