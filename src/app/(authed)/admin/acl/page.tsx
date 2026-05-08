import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import AclClient from "./AclClient";

export const metadata = { title: "Permissions — MockupAI" };

export default async function AclPage() {
  const session = await validateSession();
  if (!session || session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const rows = await prisma.tenantRolePermission.findMany({
    where: { tenantId: session.tenantId, role: "ADMIN" as any },
    select: { feature: true },
  });
  const adminFeatures = rows.map((r) => r.feature);

  return <AclClient initialAdminFeatures={adminFeatures} />;
}
