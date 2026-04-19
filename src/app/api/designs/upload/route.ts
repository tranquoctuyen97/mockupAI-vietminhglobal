/**
 * POST /api/designs/upload
 * Upload a design file (PNG/JPG/WEBP, max 20MB)
 */

import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage/local-disk";
import { probeAndPreview } from "@/lib/images/probe";
import { logAudit } from "@/lib/audit";
import formidable from "formidable";
import { readFile, unlink } from "node:fs/promises";
import { IncomingMessage } from "node:http";

export const runtime = "nodejs";

// Disable Next.js body parser — formidable handles multipart
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Convert Web Request to Node IncomingMessage for formidable
 */
async function requestToIncoming(request: Request): Promise<IncomingMessage> {
  const { Readable } = await import("node:stream");

  const body = request.body;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const readable = new Readable({
    async read() {
      if (!body) {
        this.push(null);
        return;
      }
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
            break;
          }
          this.push(Buffer.from(value));
        }
      } catch {
        this.push(null);
      }
    },
  });

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
        { error: "Vui lòng chọn file ảnh (PNG, JPG, hoặc WEBP)" },
        { status: 400 },
      );
    }

    const file = fileArray[0];

    if (!file.mimetype || !ALLOWED_TYPES.includes(file.mimetype)) {
      return NextResponse.json(
        { error: "Chỉ chấp nhận PNG, JPG, hoặc WEBP" },
        { status: 400 },
      );
    }

    // Read file buffer for probing
    const buffer = await readFile(file.filepath);

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

    // Clean up temp file
    await unlink(file.filepath).catch(() => {});

    // Extract name from fields or filename
    const name = (fields.name?.[0] || file.originalFilename || "Untitled")
      .replace(/\.[^.]+$/, ""); // Remove extension from name

    // Save to database
    const design = await prisma.design.create({
      data: {
        tenantId: session.tenantId,
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
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("[Upload] Error:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === formidable.errors.biggerThanTotalMaxFileSize
    ) {
      return NextResponse.json(
        { error: "File quá lớn (tối đa 20MB)" },
        { status: 413 },
      );
    }

    return NextResponse.json(
      { error: "Upload thất bại. Vui lòng thử lại." },
      { status: 500 },
    );
  }
}
