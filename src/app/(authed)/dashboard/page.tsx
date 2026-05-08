import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDashboardSummary } from "@/lib/analytics/queries";
import DashboardClient from "./DashboardClient";

export const metadata = {
  title: "Dashboard — MockupAI",
  description: "Tổng quan hoạt động kinh doanh POD",
};

/**
 * Dashboard — Server Component.
 * Fetches all dashboard data on the server (no client-side API calls).
 */
export default async function DashboardPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const summary = await getDashboardSummary(session.tenantId);

  return (
    <DashboardClient
      summary={summary}
    />
  );
}
