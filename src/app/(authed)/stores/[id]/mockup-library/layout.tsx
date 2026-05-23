import { validateSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/auth/roles";
import { redirect } from "next/navigation";

export default async function MockupLibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await validateSession();
  if (!session) redirect("/login");

  const ok = await hasFeature(session.tenantId, session.role, "mockup_library");
  if (!ok) redirect("/stores");

  return <>{children}</>;
}
