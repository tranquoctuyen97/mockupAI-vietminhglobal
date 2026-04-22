import { validateSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { listDrafts } from "@/lib/wizard/state";
import WizardListClient from "./WizardListClient";

export const metadata = {
  title: "Wizard — MockupAI",
  description: "Tạo listing sản phẩm POD",
};

/**
 * Wizard drafts list — Server Component.
 * Fetches drafts on the server for instant render.
 */
export default async function WizardListPage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  const drafts = await listDrafts(session.tenantId);

  // JSON roundtrip to serialize Dates → strings for client component
  const serialized = JSON.parse(JSON.stringify(drafts));

  return <WizardListClient initialDrafts={serialized} />;
}
