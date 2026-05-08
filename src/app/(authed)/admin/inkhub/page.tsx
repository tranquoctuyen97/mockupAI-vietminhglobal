import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import InkhubConfigClient from "./InkhubConfigClient";

export const metadata = { title: "InkHub Config — MockupAI" };

export default async function InkhubConfigPage() {
  const session = await validateSession();
  if (!session) redirect("/login");
  if (!(await hasFeature(session.tenantId, session.role, "inkhub_config"))) {
    redirect("/dashboard");
  }

  const row = await prisma.inkhubCredential.findUnique({
    where: { tenantId: session.tenantId },
  });

  return <InkhubConfigClient savedUsername={row?.username ?? ""} />;
}
