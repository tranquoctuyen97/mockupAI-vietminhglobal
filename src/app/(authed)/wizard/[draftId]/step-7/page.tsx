"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWizardStore } from "@/lib/wizard/use-wizard-store";
import {
  Rocket,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ArrowRight,
} from "lucide-react";

type PublishStatus = "idle" | "publishing" | "shopify" | "printify" | "done" | "failed" | "partial";

export default function Step7PublishPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const { draft } = useWizardStore();

  const [status, setStatus] = useState<PublishStatus>("idle");
  const [listingId, setListingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const aiContent = draft?.aiContent as { title?: string } | null;
  const mockupJobs = draft?.mockupJobs || [];
  const succeededMockups = mockupJobs.filter((j) => j.status === "SUCCEEDED");

  // Pre-publish checklist
  const checks = [
    { label: "Design chọn", ok: !!draft?.designId },
    { label: "Store chọn", ok: !!draft?.storeId },
    { label: "Product type chọn", ok: !!draft?.productType },
    { label: "Mockups tạo", ok: succeededMockups.length > 0 },
    { label: "AI Content tạo", ok: !!aiContent?.title },
  ];
  const allReady = checks.every((c) => c.ok);

  async function handlePublish() {
    setStatus("publishing");
    setError("");

    try {
      const res = await fetch(`/api/wizard/drafts/${draftId}/publish`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Publish failed");
        setStatus("failed");
        return;
      }

      if (data.alreadyPublished) {
        setListingId(data.listingId);
        setStatus("done");
        return;
      }

      setListingId(data.listingId);

      // Listen SSE for progress
      const channelId = `publish:${data.listingId}`;
      const es = new EventSource(`/api/wizard/drafts/${draftId}/events?channel=${channelId}`);

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "publish.shopify.start":
              setStatus("shopify");
              break;
            case "publish.shopify.done":
              setStatus("printify");
              break;
            case "publish.printify.start":
              setStatus("printify");
              break;
            case "publish.complete":
              if (msg.data.status === "ACTIVE") {
                setStatus("done");
              } else {
                setStatus("partial");
              }
              es.close();
              break;
            case "publish.failed":
              setStatus("failed");
              setError(msg.data.error || "Publish failed");
              es.close();
              break;
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        // SSE disconnected — poll status instead
        es.close();
        setTimeout(async () => {
          const statusRes = await fetch(`/api/listings/${data.listingId}`);
          if (statusRes.ok) {
            const listing = await statusRes.json();
            if (listing.status === "ACTIVE") setStatus("done");
            else if (listing.status === "PARTIAL_FAILURE") setStatus("partial");
            else if (listing.status === "FAILED") setStatus("failed");
          }
        }, 3000);
      };
    } catch {
      setError("Không thể kết nối server");
      setStatus("failed");
    }
  }

  return (
    <div>
      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 4px" }}>
        Publish
      </h2>
      <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
        Đăng sản phẩm lên Shopify & Printify
      </p>

      {/* Checklist */}
      {status === "idle" && (
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 16px" }}>
            Pre-publish Checklist
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {checks.map((c) => (
              <div
                key={c.label}
                className="flex items-center gap-3"
                style={{ fontSize: "0.85rem" }}
              >
                {c.ok ? (
                  <CheckCircle2 size={16} style={{ color: "var(--color-wise-green)" }} />
                ) : (
                  <XCircle size={16} style={{ color: "var(--color-error)", opacity: 0.5 }} />
                )}
                <span style={{ opacity: c.ok ? 1 : 0.4 }}>{c.label}</span>
              </div>
            ))}
          </div>

          <button
            className="btn btn-primary"
            onClick={handlePublish}
            disabled={!allReady}
            style={{
              marginTop: 24,
              width: "100%",
              padding: "14px 24px",
              fontSize: "0.95rem",
            }}
          >
            <Rocket size={18} />
            Publish to Shopify + Printify
          </button>
        </div>
      )}

      {/* Publishing progress */}
      {(status === "publishing" || status === "shopify" || status === "printify") && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <Loader2
            size={48}
            className="animate-spin"
            style={{ margin: "0 auto 16px", opacity: 0.5 }}
          />
          <h3 style={{ fontWeight: 700, margin: "0 0 24px" }}>Đang publish...</h3>

          {/* Stage indicators */}
          <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
            <StageIndicator
              label="Shopify"
              status={
                status === "shopify"
                  ? "running"
                  : status === "printify"
                    ? "done"
                    : "pending"
              }
            />
            <ArrowRight size={20} style={{ opacity: 0.2, alignSelf: "center" }} />
            <StageIndicator
              label="Printify"
              status={status === "printify" ? "running" : "pending"}
            />
          </div>
        </div>
      )}

      {/* Success */}
      {status === "done" && listingId && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--color-wise-green), #6ba832)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <CheckCircle2 size={32} color="white" />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Publish thành công!</h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
            Sản phẩm đã được đăng lên Shopify & Printify
          </p>
          <button
            className="btn btn-primary"
            onClick={() => router.push(`/listings/${listingId}`)}
          >
            <ExternalLink size={16} />
            Xem Listing
          </button>
        </div>
      )}

      {/* Partial failure */}
      {status === "partial" && listingId && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "#f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <XCircle size={32} color="white" />
          </div>
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Partial Success</h3>
          <p style={{ opacity: 0.5, fontSize: "0.85rem", margin: "0 0 24px" }}>
            Shopify ✅ Active — Printify ❌ cần retry
          </p>
          <button
            className="btn btn-primary"
            onClick={() => router.push(`/listings/${listingId}`)}
          >
            <ExternalLink size={16} />
            Xem & Retry
          </button>
        </div>
      )}

      {/* Failed */}
      {status === "failed" && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <XCircle
            size={48}
            style={{ color: "var(--color-error)", margin: "0 auto 16px" }}
          />
          <h3 style={{ fontWeight: 700, margin: "0 0 8px" }}>Publish thất bại</h3>
          <p
            style={{
              color: "var(--color-error)",
              fontSize: "0.85rem",
              margin: "0 0 24px",
            }}
          >
            {error}
          </p>
          <button className="btn btn-secondary" onClick={() => setStatus("idle")}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}

function StageIndicator({
  label,
  status,
}: {
  label: string;
  status: "pending" | "running" | "done";
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: "10px 20px",
        borderRadius: "var(--radius-sm)",
        backgroundColor:
          status === "done"
            ? "rgba(146, 198, 72, 0.12)"
            : status === "running"
              ? "rgba(245, 158, 11, 0.12)"
              : "var(--bg-tertiary)",
        fontWeight: 600,
        fontSize: "0.85rem",
        opacity: status === "pending" ? 0.4 : 1,
      }}
    >
      {status === "running" && <Loader2 size={14} className="animate-spin" />}
      {status === "done" && (
        <CheckCircle2 size={14} style={{ color: "var(--color-wise-green)" }} />
      )}
      {label}
    </div>
  );
}
