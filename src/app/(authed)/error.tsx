"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Error boundary for authed area.
 * Provides retry action (error-recovery §8).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 48, textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          backgroundColor: "rgba(239,68,68,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
        }}
      >
        <AlertTriangle size={28} style={{ color: "#ef4444" }} />
      </div>

      <h2 style={{ fontWeight: 700, fontSize: "1.25rem", margin: "0 0 8px" }}>
        Đã xảy ra lỗi
      </h2>
      <p style={{ opacity: 0.6, fontSize: "0.85rem", margin: "0 0 24px", lineHeight: 1.5 }}>
        {error.message || "Đã có lỗi không mong muốn. Vui lòng thử lại."}
      </p>

      <button className="btn-primary" onClick={reset} style={{ fontSize: "0.9rem" }}>
        Thử lại
      </button>
    </div>
  );
}
