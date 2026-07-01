import type { UserRole } from "@prisma/client";
import { cache } from "react";
import { prisma } from "@/lib/db";

export const FEATURES = [
  "stores",
  "designs",
  "wizard",
  "listings",
  "auto_fulfill",
  "mockup_library",
  "ai_hub",
  "users",
  "pricing",
  "integrations",
  "ai_settings",
  "inkhub_config",
  "mailboxes",
] as const;

export type Feature = (typeof FEATURES)[number];

export const getPermissionSet = cache(
  async (tenantId: string, role: string): Promise<Set<string>> => {
    const rows = await prisma.tenantRolePermission.findMany({
      where: { tenantId, role: role as UserRole },
      select: { feature: true },
    });
    return new Set(rows.map((r) => r.feature));
  },
);

export async function hasFeature(
  tenantId: string,
  role: string,
  feature: Feature,
  _fetchPermissions?: (tenantId: string, role: string) => Promise<Set<string>>,
): Promise<boolean> {
  if (role === "SUPER_ADMIN") return true;
  const fetch = _fetchPermissions ?? getPermissionSet;
  const perms = await fetch(tenantId, role);
  return perms.has(feature);
}
