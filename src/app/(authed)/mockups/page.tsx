import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import MockupsClient from "./MockupsClient";

export const metadata = {
  title: "Mockups - MockupAI",
};

export default async function MockupsPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  const canUseMockups = await hasFeature(session.tenantId, session.role, "mockup_library");
  if (!canUseMockups) redirect("/dashboard");

  return <MockupsClient />;
}
