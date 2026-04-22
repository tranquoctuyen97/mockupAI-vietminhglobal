import Link from "next/link";

/**
 * Custom 404 page with helpful guidance (empty-states §8).
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div
          style={{
            fontSize: "5rem",
            fontWeight: 900,
            lineHeight: 1,
            marginBottom: 8,
            opacity: 0.15,
            fontFamily: "var(--font-display)",
          }}
        >
          404
        </div>
        <h1 style={{ fontWeight: 700, fontSize: "1.5rem", margin: "0 0 8px" }}>
          Trang không tồn tại
        </h1>
        <p style={{ opacity: 0.5, fontSize: "0.9rem", margin: "0 0 24px", lineHeight: 1.5 }}>
          URL bạn đang tìm không tồn tại hoặc đã bị xóa.
        </p>
        <Link
          href="/dashboard"
          className="btn-primary"
          style={{ textDecoration: "none", fontSize: "0.9rem" }}
        >
          Về Dashboard
        </Link>
      </div>
    </div>
  );
}
