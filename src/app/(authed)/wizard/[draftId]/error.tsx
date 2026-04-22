"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Wizard error boundary with retry + back navigation.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 48, textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          backgroundColor: "rgba(239,68,68,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 12px",
        }}
      >
        <AlertTriangle size={24} style={{ color: "#ef4444" }} />
      </div>

      <h2 style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0 0 8px" }}>
        Wizard gặp lỗi
      </h2>
      <p style={{ opacity: 0.6, fontSize: "0.85rem", margin: "0 0 20px", lineHeight: 1.5 }}>
        {error.message || "Đã có lỗi khi tải bước này."}
      </p>

      <button className="btn-primary" onClick={reset} style={{ fontSize: "0.85rem" }}>
        Thử lại
      </button>
    </div>
  );
}
