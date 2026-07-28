import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";

export default async function AccountPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  return (
    <section className="card card-lg max-w-2xl">
      <h2 className="text-card-heading">Profile</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-caption" style={{ color: "var(--text-muted)" }}>
            Email
          </dt>
          <dd className="mt-1">{session.email}</dd>
        </div>
        <div>
          <dt className="text-caption" style={{ color: "var(--text-muted)" }}>
            Role
          </dt>
          <dd className="mt-1">
            <span className="badge badge-info">{session.role}</span>
          </dd>
        </div>
        <div>
          <dt className="text-caption" style={{ color: "var(--text-muted)" }}>
            Account status
          </dt>
          <dd className="mt-1">{session.status}</dd>
        </div>
        <div>
          <dt className="text-caption" style={{ color: "var(--text-muted)" }}>
            Tenant
          </dt>
          <dd className="mt-1 font-mono text-sm">{session.tenantId}</dd>
        </div>
      </dl>
    </section>
  );
}
