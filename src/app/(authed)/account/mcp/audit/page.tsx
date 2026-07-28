import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export default async function McpAuditPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  const events = await prisma.auditEvent.findMany({
    where: {
      tenantId: session.tenantId,
      actorUserId: session.id,
      action: { startsWith: "mcp." },
    },
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <section className="card card-lg">
      <h2 className="text-card-heading">Your MCP audit trail</h2>
      <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
        Security events for your own MCP profile and credentials.
      </p>
      <div className="mt-5 space-y-2">
        {events.map((event) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            key={event.id}
            style={{ borderColor: "var(--border-default)" }}
          >
            <div>
              <p className="font-semibold">{event.action}</p>
              <p className="text-caption" style={{ color: "var(--text-muted)" }}>
                {event.resourceType} · {event.resourceId ?? "role-wide"}
              </p>
            </div>
            <time className="text-caption" style={{ color: "var(--text-muted)" }}>
              {event.createdAt.toLocaleString()}
            </time>
          </div>
        ))}
        {events.length === 0 && (
          <p className="text-body py-8 text-center" style={{ color: "var(--text-muted)" }}>
            No MCP events yet.
          </p>
        )}
      </div>
    </section>
  );
}
