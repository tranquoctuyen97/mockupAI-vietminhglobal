import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import AuthedShell from "./AuthedShell";

/**
 * Server Component layout for authed area.
 * Validates session and fetches user role on the server.
 * Passes userRole to client shell as a prop (no client-side fetch needed).
 */
export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await validateSession();

  if (!user) {
    redirect("/login");
  }

  return (
    <AuthedShell userRole={user.role}>
      {children}
    </AuthedShell>
  );
}
