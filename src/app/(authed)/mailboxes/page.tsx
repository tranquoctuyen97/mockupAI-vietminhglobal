import { validateSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import MailboxesClient from "./MailboxesClient";

export const metadata = {
  title: "Mailboxes — MockupAI",
  description: "Quản lý email từ nhiều mailbox trong một giao diện",
};

export default async function MailboxesPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const canAccess = await hasFeature(session.tenantId, session.role, "mailboxes");
  if (!canAccess) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: "60vh" }}
      >
        <div className="text-center" style={{ maxWidth: 400, padding: 40 }}>
          <div style={{ fontSize: "3rem", marginBottom: 16, opacity: 0.3 }}>
            🔒
          </div>
          <p
            className="text-body"
            style={{ color: "var(--text-secondary)" }}
          >
            Bạn không có quyền truy cập Mailboxes.
          </p>
        </div>
      </div>
    );
  }

  return <MailboxesClient />;
}
