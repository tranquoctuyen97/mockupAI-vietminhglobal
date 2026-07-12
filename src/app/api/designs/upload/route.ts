/**
 * POST /api/designs/upload
 * Upload a design file (PNG/JPG, max 20MB)
 */

import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import formidable from "formidable";
import { NextResponse } from "next/server";

import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { probeAndPreview } from "@/lib/images/probe";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Disable Next.js body parser — formidable handles multipart
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB — khớp giới hạn Printify
const ALLOWED_TYPES = ["image/png", "image/jpeg"];

/**
 * Convert Web Request to Node IncomingMessage for formidable
 */
async function requestToIncoming(request: Request): Promise<IncomingMessage> {
  const body = request.body;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const readable = new Readable({
    read() {
      // no-op — data được pump từ bên ngoài
    },
  });

  // Pump data từ Web ReadableStream sang Node Readable (tạo reader 1 lần)
  if (body) {
    const reader = body.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            readable.push(null);
            break;
          }
          readable.push(Buffer.from(value));
        }
      } catch {
        readable.push(null);
      }
    })();
  } else {
    readable.push(null);
  }

  // Attach headers to the readable stream (formidable needs them)
  Object.assign(readable, {
    headers,
    method: request.method,
    url: "",
  });

  return readable as unknown as IncomingMessage;
}

export async function POST(request: Request) {
  const session = await validateSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tempFilePath: string | null = null;

  try {
    // Parse multipart form
    const incoming = await requestToIncoming(request);

    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      maxFiles: 1,
      filter: ({ mimetype }) => {
        return !!mimetype && ALLOWED_TYPES.includes(mimetype);
      },
    });

    const [fields, files] = await form.parse(incoming);

    const fileArray = files.file;
    if (!fileArray || fileArray.length === 0) {
      return NextResponse.json(
        { error: "Vui lòng chọn file ảnh (PNG hoặc JPG)" },
        { status: 400 },
      );
    }

    const file = fileArray[0];
    tempFilePath = file.filepath;

    if (!file.mimetype || !ALLOWED_TYPES.includes(file.mimetype)) {
      return NextResponse.json(
        { error: "Chỉ chấp nhận PNG hoặc JPG" },
        { status: 400 },
      );
    }

    const storeId = fields.storeId?.[0]?.trim();
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

    // Probe metadata + generate preview
    const probeResult = await probeAndPreview(file.filepath);

    // Generate storage keys
    const designId = `design_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = probeResult.format === "jpeg" ? "jpg" : probeResult.format;
    const originalKey = `originals/${designId}.${ext}`;
    const previewKey = `previews/${designId}.webp`;

    // Save files to storage
    const storage = getStorage();
    if (probeResult.normalizedBuffer) {
      await storage.putBuffer(originalKey, probeResult.normalizedBuffer, probeResult.mimeType);
    } else {
      await storage.putStream(originalKey, createReadStream(file.filepath), probeResult.mimeType);
    }
    await storage.putBuffer(previewKey, probeResult.previewBuffer, "image/webp");

    // Clean up temp file
    await unlink(file.filepath).catch(() => {});
    tempFilePath = null;

    // Extract name from fields or filename
    const name = (fields.name?.[0] || file.originalFilename || "Untitled")
      .replace(/\.[^.]+$/, ""); // Remove extension from name

    // Save to database
    const design = await prisma.design.create({
      data: {
        tenantId: session.tenantId,
        storeId: store.id,
        ownerUserId: session.id,
        name,
        originalFilename: file.originalFilename || "unknown",
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
        wasNormalized: probeResult.wasNormalized,
        originalWidth: probeResult.originalWidth,
        originalHeight: probeResult.originalHeight,
        originalFileSize: probeResult.originalFileSize,
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

    const errorCode =
      error && typeof error === "object" && "code" in error
        ? (error as { code: number }).code
        : null;

    // 1009 = biggerThanTotalMaxFileSize, 1012 = malformedMultipart (stream bị cắt)
    if (errorCode === 1009 || errorCode === 1012) {
      return NextResponse.json(
        { error: "File quá lớn (tối đa 100MB)" },
        { status: 413 },
      );
    }

    const errorMessage = error instanceof Error ? error.message : "";
    if (
      errorMessage.includes("exceeds pixel limit") ||
      errorMessage.includes("30,000px limit")
    ) {
      return NextResponse.json(
        { error: "Ảnh quá lớn về kích thước pixel (tối đa 30,000 x 30,000 px)" },
        { status: 413 },
      );
    }

    return NextResponse.json(
      { error: "Upload thất bại. Vui lòng thử lại." },
      { status: 500 },
    );
  } finally {
    if (tempFilePath) {
      await unlink(tempFilePath).catch(() => {});
    }
  }
}
