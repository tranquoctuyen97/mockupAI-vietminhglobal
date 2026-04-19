/**
 * GET /api/files/[...key]
 * Serve uploaded files from local storage (dev mode)
 * In production, Nginx handles this via X-Accel-Redirect
 */

import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/local-disk";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const runtime = "nodejs";

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const filePath = key.join("/");
  const storage = getStorage();
  const absPath = storage.resolvePath(filePath);

  try {
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    // Read file and return as response
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(absPath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
