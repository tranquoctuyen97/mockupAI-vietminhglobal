import { redirect } from "next/navigation";

import { validateSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DEFAULT_TRIPLE_WHALE_TIMEZONE } from "@/lib/triple-whale/timezone";
import DashboardClient from "./DashboardClient";

export const metadata = {
  title: "Dashboard — MockupAI",
  description: "Tổng quan hoạt động kinh doanh POD",
};

/**
 * Dashboard — Server Component.
 * Loads the tenant timezone for dashboard rendering.
 */
export default async function DashboardPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { twTimezone: true },
  });

  return <DashboardClient twTimezone={tenant?.twTimezone ?? DEFAULT_TRIPLE_WHALE_TIMEZONE} />;
}
