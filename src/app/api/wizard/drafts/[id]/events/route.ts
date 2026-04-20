/**
 * GET /api/wizard/drafts/:id/events — SSE stream
 * Real-time mockup generation progress
 *
 * Phase 6.10 Bug #1 fix:
 * - Added graceful degrade when Redis/BullMQ is down
 * - Returns 200 + error event in stream (not 503 hard-fail)
 * - Added console.error for dev visibility
 */

import { validateSession } from "@/lib/auth/session";
import { sseChannels, type SSEEvent } from "@/lib/sse/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: draftId } = await params;

  const encoder = new TextEncoder();

  // Wrap the entire stream setup in try/catch — any import or init error
  // (e.g. Redis not up → BullMQ throw) gets caught and degraded gracefully
  try {
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;

        function safeEnqueue(chunk: Uint8Array) {
          if (!closed) {
            try {
              controller.enqueue(chunk);
            } catch {
              closed = true;
            }
          }
        }

        const emitter = sseChannels.getOrCreate(draftId);

        // Send initial connection event
        safeEnqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "connected", draftId })}\n\n`),
        );

        // Listen for events
        const onMessage = (event: SSEEvent) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        emitter.on("message", onMessage);

        // Heartbeat every 15s to keep connection alive
        const heartbeat = setInterval(() => {
          if (closed) { clearInterval(heartbeat); return; }
          safeEnqueue(encoder.encode(":ping\n\n"));
        }, 15000);

        // Cleanup on client disconnect
        request.signal.addEventListener("abort", () => {
          closed = true;
          emitter.off("message", onMessage);
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Nginx/proxy: disable buffering so events are streamed immediately
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    // Graceful degrade: return a single error event then close
    // (200 + stream so EventSource doesn't retry aggressively)
    console.error("[SSE] Stream setup failed:", err);

    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: "SSE không khả dụng tạm thời. Vui lòng tải lại trang." })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    return new Response(errorStream, {
      status: 200, // NOT 503 — EventSource handles 200 correctly
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }
}
