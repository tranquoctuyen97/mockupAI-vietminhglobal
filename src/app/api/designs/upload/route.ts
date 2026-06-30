/**
 * POST /api/designs/upload
 * Upload a design file (PNG/JPG, max 20MB)
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { probeAndPreview } from "@/lib/images/probe";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB — khớp giới hạn Printify
const ALLOWED_TYPES = ["image/png", "image/jpeg"];

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Vui lòng chọn file ảnh (PNG hoặc JPG)" },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Chỉ chấp nhận PNG hoặc JPG" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File quá lớn (tối đa 100MB)" },
        { status: 413 },
      );
    }

    const storeId = stringField(formData, "storeId");
    if (!storeId) {
      return NextResponse.json(
        { error: "Vui lòng chọn store trước khi upload" },
        { status: 400 },
      );
    }

    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true, name: true },
    });

    if (!store) {
      return NextResponse.json(
        { error: "Store không hợp lệ hoặc không thuộc tenant hiện tại" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Probe metadata + generate preview
    const probeResult = await probeAndPreview(buffer);

    // Generate storage keys
    const designId = `design_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = probeResult.format === "jpeg" ? "jpg" : probeResult.format;
    const originalKey = `originals/${designId}.${ext}`;
    const previewKey = `previews/${designId}.webp`;

    // Save files to storage
    const storage = getStorage();
    await storage.putBuffer(originalKey, buffer);
    await storage.putBuffer(previewKey, probeResult.previewBuffer);

    // Extract name from fields or filename
    const name = (stringField(formData, "name") || file.name || "Untitled")
      .replace(/\.[^.]+$/, ""); // Remove extension from name

    // Save to database
    const design = await prisma.design.create({
      data: {
        tenantId: session.tenantId,
        storeId: store.id,
        ownerUserId: session.id,
        name,
        originalFilename: file.name || "unknown",
        storagePath: originalKey,
        previewPath: previewKey,
        width: probeResult.width,
        height: probeResult.height,
        dpi: probeResult.dpi,
        fileSizeBytes: probeResult.fileSize,
        mimeType: probeResult.mimeType,
      },
    });

    // Audit log
    await logAudit({
      tenantId: session.tenantId,
      actorUserId: session.id,
      action: "design.uploaded",
      resourceType: "design",
      resourceId: design.id,
      metadata: {
        name,
        storeId: store.id,
        width: probeResult.width,
        height: probeResult.height,
        dpi: probeResult.dpi,
        fileSize: probeResult.fileSize,
      },
    });

    return NextResponse.json({
      id: design.id,
      name: design.name,
      width: design.width,
      height: design.height,
      dpi: design.dpi,
      fileSizeBytes: design.fileSizeBytes,
      previewUrl: storage.getPublicUrl(previewKey),
      originalUrl: storage.getPublicUrl(originalKey),
      store,
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("[Upload] Error:", error);

    return NextResponse.json(
      { error: "Upload thất bại. Vui lòng thử lại." },
      { status: 500 },
    );
  }
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
