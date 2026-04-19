import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function CustomAppGuidePage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <Link
        href="/stores/new"
        className="flex items-center gap-2"
        style={{ fontSize: "0.875rem", opacity: 0.6, color: "inherit", marginBottom: 24 }}
      >
        <ArrowLeft size={14} />
        Quay lại kết nối Store
      </Link>

      <h1 className="page-title">Hướng dẫn tạo Shopify App</h1>
      <p className="page-subtitle" style={{ marginBottom: 32 }}>
        Bạn không cần tạo app thủ công. MockupAI sử dụng OAuth — chỉ cần nhập domain và authorize.
      </p>

      <div className="card" style={{ padding: 32 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 16 }}>
          Cách kết nối Shopify Store
        </h2>

        <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>
            Vào trang{" "}
            <Link href="/stores/new" style={{ color: "var(--color-wise-green)", fontWeight: 600 }}>
              Kết nối Store mới
            </Link>
          </li>
          <li>Nhập Shopify domain (VD: <code>mystore</code>)</li>
          <li>Click &quot;Kết nối với Shopify&quot;</li>
          <li>Trên Shopify, click &quot;Install app&quot; để authorize</li>
          <li>Tự động quay về MockupAI — store đã kết nối!</li>
        </ol>

        <div
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-tertiary)",
          }}
        >
          <h3 style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 8 }}>
            Quyền cần thiết (tự động request)
          </h3>
          <ul style={{ paddingLeft: 20, fontSize: "0.875rem", opacity: 0.8 }}>
            <li><code>write_products</code> — Tạo/cập nhật sản phẩm</li>
            <li><code>read_products</code> — Đọc danh sách sản phẩm</li>
            <li><code>read_orders</code> — Đọc đơn hàng (auto-fulfill)</li>
            <li><code>write_inventory</code> — Cập nhật tồn kho</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ padding: 32, marginTop: 16 }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 16 }}>
          Printify API Key
        </h2>
        <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>
            Vào{" "}
            <a
              href="https://printify.com/app/account/settings/connections"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-wise-green)" }}
            >
              Printify Settings → Connections
              <ExternalLink size={12} style={{ display: "inline", marginLeft: 4 }} />
            </a>
          </li>
          <li>Click &quot;Generate&quot; → copy Personal Access Token</li>
          <li>Paste vào tab Printify trong cấu hình store</li>
        </ol>
      </div>
    </div>
  );
}
