import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export default async function AccountStoresPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  const stores = await prisma.store.findMany({
    where: { tenantId: session.tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      shopifyDomain: true,
      printifyShopTitle: true,
      status: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <section className="card card-lg">
      <h2 className="text-card-heading">Tenant stores</h2>
      <p className="text-body mt-1" style={{ color: "var(--text-secondary)" }}>
        MCP can list every store in this tenant. A default store is only a convenience, never an
        access boundary.
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Store</th>
              <th>Shopify</th>
              <th>Printify</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.id}>
                <td>{store.name}</td>
                <td>{store.shopifyDomain}</td>
                <td>{store.printifyShopTitle ?? "Not connected"}</td>
                <td>{store.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
