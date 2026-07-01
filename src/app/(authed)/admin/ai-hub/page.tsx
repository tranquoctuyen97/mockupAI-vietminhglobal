import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { validateSession } from "@/lib/auth/session";
import AiHubAdminClient from "./AiHubAdminClient";

export const metadata = { title: "AI Hub Admin — MockupAI" };

export default async function AiHubAdminPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN") redirect("/dashboard");

  const ok = await hasFeature(session.tenantId, session.role, "ai_hub");
  if (!ok) redirect("/dashboard");

  return <AiHubAdminClient />;
}
