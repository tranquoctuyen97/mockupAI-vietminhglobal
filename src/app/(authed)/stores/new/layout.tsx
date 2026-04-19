import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function NewStoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await validateSession();

  if (!session || session.role !== "ADMIN") {
    // Redirect non-admins out of the store creation area
    redirect("/dashboard");
  }

  return <>{children}</>;
}
