"use client";

/**
 * Global Error Boundary — catches errors from the root layout.
 * Must include <html> and <body> tags since root layout may be broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: "#0e0f0c",
          backgroundColor: "#ffffff",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
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
              fontSize: 28,
            }}
          >
            ⚠️
          </div>

          <h2 style={{ fontWeight: 700, fontSize: "1.25rem", margin: "0 0 8px" }}>
            Đã xảy ra lỗi hệ thống
          </h2>
          <p
            style={{
              opacity: 0.6,
              fontSize: "0.85rem",
              margin: "0 0 24px",
              lineHeight: 1.5,
            }}
          >
            {error.message || "Đã có lỗi không mong muốn. Vui lòng thử lại."}
          </p>

          <button
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.625rem 1.5rem",
              backgroundColor: "#9fe870",
              color: "#163300",
              fontWeight: 600,
              fontSize: "1rem",
              borderRadius: 9999,
              border: "none",
              cursor: "pointer",
            }}
          >
            Thử lại
          </button>
        </div>
      </body>
    </html>
  );
}
