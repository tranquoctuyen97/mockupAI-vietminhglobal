/**
 * Admin guard for mailbox management routes.
 *
 * Requires:
 * 1. Authenticated session
 * 2. hasFeature("mailboxes") for tenant
 * 3. Role is SUPER_ADMIN or ADMIN
 * 4. OPERATOR is always denied
 *
 * This is separate from requireFeature("mailboxes") because OPERATOR
 * also has the mailboxes feature (for inbox access), but must NOT
 * access admin config routes.
 */
import { NextResponse } from "next/server";
import { hasFeature } from "./roles";
import { validateSession } from "./session";

type AuthSession = NonNullable<Awaited<ReturnType<typeof validateSession>>>;

type GuardResult =
  | { session: AuthSession; response: null }
  | { session: null; response: NextResponse };

export { type AuthSession, type GuardResult };

/**
 * Guard for admin mailbox management routes.
 * OPERATOR always gets 403 even though they have the mailboxes feature.
 */
export async function requireMailboxAdmin(): Promise<GuardResult> {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Feature gate
  const ok = await hasFeature(session.tenantId, session.role, "mailboxes");
  if (!ok) {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  // Role gate — SUPER_ADMIN or ADMIN only, OPERATOR denied
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Forbidden — admin only" },
        { status: 403 },
      ),
    };
  }

  return { session, response: null };
}
