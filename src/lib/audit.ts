import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

interface AuditLogInput {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Log an audit event for any mutation
 * Called from every API route that modifies data
 *
 * Action naming convention: "resource.verb"
 * Examples: "user.created", "user.password_reset", "feature_flag.toggled"
 */
export async function logAudit(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  } catch (error) {
    // Never let audit logging break the main flow
    console.error("[AUDIT] Failed to log event:", error);
  }
}

/**
 * Helper to extract IP and User-Agent from request
 */
export function getRequestInfo(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null,
    userAgent: request.headers.get("user-agent") || null,
  };
}
