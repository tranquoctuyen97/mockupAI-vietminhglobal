import { redirect } from "next/navigation";
import { validateSession } from "@/lib/auth/session";
import TripleWhaleClient from "./TripleWhaleClient";

export const metadata = { title: "Triple Whale — MockupAI" };

export default async function TripleWhalePage() {
  const session = await validateSession();
  if (!session) redirect("/login");

  return <TripleWhaleClient />;
}
