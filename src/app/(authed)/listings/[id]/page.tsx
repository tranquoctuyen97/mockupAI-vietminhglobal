"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

interface Listing {
  id: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
  status: string;
  priceUsd: number;
  shopifyProductId: string | null;
  printifyProductId: string | null;
  publishedAt: string | null;
  createdAt: string;
  variants: Array<{
    id: string;
    colorName: string;
    colorHex: string;
    size: string;
    shopifyVariantId: string | null;
    printifyVariantId: string | null;
    sku: string | null;
  }>;
  publishJobs: Array<{
    id: string;
    stage: string;
    status: string;
    attempts: number;
    lastError: string | null;
    completedAt: string | null;
  }>;
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  async function fetchListing() {
    try {
      const res = await fetch(`/api/listings/${id}`);
      if (res.ok) {
        setListing(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchListing();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRetryPrintify() {
    setRetrying(true);
    try {
      await fetch(`/api/listings/${id}/retry-printify`, { method: "POST" });
      // Poll for update
      setTimeout(fetchListing, 5000);
    } catch {
      // ignore
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: 64, opacity: 0.5 }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        <p>Listing not found</p>
      </div>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    PUBLISHING: { label: "Publishing...", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
    ACTIVE: { label: "Active", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
    PARTIAL_FAILURE: { label: "Partial Failure", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    FAILED: { label: "Failed", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  };

  const sc = statusConfig[listing.status] || statusConfig.FAILED;

  return (
    <div>
      <div className="flex items-center gap-3" style={{ marginBottom: 24 }}>
        <Link href="/listings" style={{ color: "inherit", opacity: 0.5, display: "flex" }}>
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="page-title" style={{ margin: 0 }}>
            {listing.title}
          </h1>
          <div className="flex items-center gap-3" style={{ marginTop: 4 }}>
            <span
              style={{
                padding: "3px 10px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: sc.bg,
                color: sc.color,
                fontWeight: 600,
                fontSize: "0.75rem",
              }}
            >
              {sc.label}
            </span>
            <span style={{ fontSize: "0.8rem", opacity: 0.5 }}>
              ${listing.priceUsd.toFixed(2)}
            </span>
          </div>
        </div>

        {listing.status === "PARTIAL_FAILURE" && (
          <button
            className="btn btn-primary"
            onClick={handleRetryPrintify}
            disabled={retrying}
          >
            {retrying ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Retry Printify
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left: Info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Description */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 12px" }}>
              Description
            </h3>
            <div
              style={{ fontSize: "0.85rem", lineHeight: 1.5 }}
              dangerouslySetInnerHTML={{ __html: listing.descriptionHtml }}
            />
          </div>

          {/* Tags */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 12px" }}>
              Tags
            </h3>
            <div className="flex flex-wrap gap-1">
              {listing.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                    fontSize: "0.75rem",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* External links */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 12px" }}>
              External IDs
            </h3>
            <div style={{ fontSize: "0.85rem", lineHeight: 2 }}>
              <div className="flex items-center gap-2">
                <span style={{ opacity: 0.5, minWidth: 80 }}>Shopify:</span>
                {listing.shopifyProductId ? (
                  <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {listing.shopifyProductId.split("/").pop()}
                  </span>
                ) : (
                  <span style={{ opacity: 0.3 }}>—</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span style={{ opacity: 0.5, minWidth: 80 }}>Printify:</span>
                {listing.printifyProductId ? (
                  <span style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {listing.printifyProductId}
                  </span>
                ) : (
                  <span style={{ opacity: 0.3 }}>—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Variants + Jobs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Variants */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 12px" }}>
              Variants ({listing.variants.length})
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {listing.variants.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                    fontSize: "0.8rem",
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      backgroundColor: v.colorHex,
                      border: "1px solid var(--border-default)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, flex: 1 }}>{v.colorName}</span>
                  <span style={{ opacity: 0.5, fontSize: "0.7rem" }}>{v.size}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Publish Jobs */}
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontWeight: 600, fontSize: "0.9rem", margin: "0 0 12px" }}>
              Publish Jobs
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {listing.publishJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between"
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-tertiary)",
                    fontSize: "0.8rem",
                  }}
                >
                  <div className="flex items-center gap-2">
                    {job.status === "SUCCEEDED" && (
                      <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
                    )}
                    {job.status === "FAILED" && (
                      <XCircle size={14} style={{ color: "#ef4444" }} />
                    )}
                    {job.status === "RUNNING" && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    {job.status === "PENDING" && (
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: "2px solid var(--border-default)",
                        }}
                      />
                    )}
                    <span style={{ fontWeight: 600 }}>{job.stage}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.lastError && (
                      <span
                        style={{ color: "#ef4444", fontSize: "0.7rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                        title={job.lastError}
                      >
                        {job.lastError.slice(0, 50)}
                      </span>
                    )}
                    <span style={{ opacity: 0.5 }}>
                      {job.attempts > 0 ? `${job.attempts} attempts` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
