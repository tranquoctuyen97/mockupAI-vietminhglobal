import { NextResponse } from "next/server";
import { type Feature, hasFeature } from "./roles";
import { validateSession } from "./session";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof validateSession>>>;

type GuardResult =
  | { session: AuthSession; response: null }
  | { session: null; response: NextResponse };

export async function requireFeature(feature: Feature): Promise<GuardResult> {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const ok = await hasFeature(session.tenantId, session.role, feature);
  if (!ok) {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export async function requireSuperAdmin(): Promise<GuardResult> {
  const session = await validateSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.role !== "SUPER_ADMIN") {
    return {
      session: null,
      response: NextResponse.json({ error: "Forbidden — SUPER_ADMIN only" }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export async function requireAdminSession(): Promise<GuardResult> {
  return requireFeature("stores");
}
