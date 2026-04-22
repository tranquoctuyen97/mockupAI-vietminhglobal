import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDashboardSummary, getOrdersByDay, getTopDesigns } from "@/lib/analytics/queries";
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

  const now = new Date();
  const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [summary, chartData, topDesigns] = await Promise.all([
    getDashboardSummary(session.tenantId),
    getOrdersByDay(session.tenantId, fromDate, now),
    getTopDesigns(session.tenantId, 10),
  ]);

  return (
    <DashboardClient
      summary={summary}
      chartData={chartData}
      topDesigns={topDesigns}
    />
  );
}
