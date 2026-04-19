"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";

interface ExpiredStore {
  id: string;
  name: string;
  shopifyDomain: string;
}

export default function TokenExpiredBanner() {
  const [expiredStores, setExpiredStores] = useState<ExpiredStore[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/stores")
      .then((res) => res.json())
      .then((stores) => {
        const expired = stores.filter(
          (s: { status: string }) => s.status === "TOKEN_EXPIRED",
        );
        setExpiredStores(expired);
      })
      .catch(() => {});
  }, []);

  if (dismissed || expiredStores.length === 0) return null;

  return (
    <div
      style={{
        padding: "10px 20px",
        backgroundColor: "rgba(234, 179, 8, 0.12)",
        border: "1px solid rgba(234, 179, 8, 0.3)",
        borderRadius: "var(--radius-md)",
        marginBottom: 24,
        fontSize: "0.875rem",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ color: "#eab308" }}>
          <AlertTriangle size={16} />
          <span>
            {expiredStores.length === 1 ? (
              <>
                Store <strong>{expiredStores[0].name}</strong> token hết hạn.{" "}
                <Link
                  href={`/stores/${expiredStores[0].id}/config`}
                  style={{ color: "#eab308", textDecoration: "underline" }}
                >
                  Cập nhật ngay
                </Link>
              </>
            ) : (
              <>
                {expiredStores.length} store có token hết hạn.{" "}
                <Link href="/stores" style={{ color: "#eab308", textDecoration: "underline" }}>
                  Xem chi tiết
                </Link>
              </>
            )}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{ padding: 4, backgroundColor: "transparent", border: "none", cursor: "pointer", opacity: 0.5 }}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
