import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await validateSession();

  if (!session || session.role !== "ADMIN") {
    // Redirect non-admins out of the entire /admin zone
    redirect("/dashboard");
  }

  return <>{children}</>;
}
