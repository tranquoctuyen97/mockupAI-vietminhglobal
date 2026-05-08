import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature, FEATURES, type Feature } from "@/lib/auth/roles";
import AuthedShell from "./AuthedShell";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await validateSession();
  if (!user) redirect("/login");

  // Compute all permissions for this user in one pass
  const permissions: Feature[] = [];
  for (const feature of FEATURES) {
    if (await hasFeature(user.tenantId, user.role, feature)) {
      permissions.push(feature);
    }
  }

  return (
    <AuthedShell userRole={user.role} permissions={permissions}>
      {children}
    </AuthedShell>
  );
}
