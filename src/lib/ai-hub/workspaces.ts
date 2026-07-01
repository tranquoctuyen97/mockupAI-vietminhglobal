import { mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

export const AI_HUB_PROVIDER_CODEX = "codex";
export const AI_HUB_PRIVATE_TYPE = "private";
export const AI_HUB_SHARED_TYPE = "shared";

export type AiHubWorkspaceListItem = {
  name: string;
  path: string;
};

export type AiHubSession = {
  id: string;
  tenantId: string;
};

export function normalizeWorkspacePath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function buildMemberWorkspacePath(root: string, userId: string): string {
  return normalizeWorkspacePath(path.posix.join(normalizeWorkspacePath(root), userId));
}

export function isPathAllowed(candidate: string, allowlist: string[]): boolean {
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  return allowlist.some((allowed) => {
    const normalizedAllowed = normalizeWorkspacePath(allowed);
    return (
      normalizedCandidate === normalizedAllowed ||
      normalizedCandidate.startsWith(`${normalizedAllowed}/`)
    );
  });
}

export function getAiHubMembersRoot(): string {
  return normalizeWorkspacePath(process.env.AI_HUB_MEMBERS_ROOT ?? "/srv/ai-hub/members");
}

export function getAiHubSharedRoot(): string {
  return normalizeWorkspacePath(process.env.AI_HUB_SHARED_ROOT ?? "/srv/ai-hub/common");
}

export async function ensureAiHubWorkspaces(
  session: AiHubSession,
): Promise<AiHubWorkspaceListItem[]> {
  const privatePath = buildMemberWorkspacePath(getAiHubMembersRoot(), session.id);
  const sharedPath = getAiHubSharedRoot();

  await Promise.all([
    mkdir(privatePath, { recursive: true }),
    mkdir(sharedPath, { recursive: true }),
  ]);

  const [privateWorkspace, sharedWorkspace] = await prisma.$transaction(async (tx) => {
    const privateRow = await tx.aiHubWorkspace.upsert({
      where: {
        tenantId_provider_path: {
          tenantId: session.tenantId,
          provider: AI_HUB_PROVIDER_CODEX,
          path: privatePath,
        },
      },
      create: {
        tenantId: session.tenantId,
        provider: AI_HUB_PROVIDER_CODEX,
        name: "My workspace",
        path: privatePath,
        type: AI_HUB_PRIVATE_TYPE,
      },
      update: { name: "My workspace", type: AI_HUB_PRIVATE_TYPE },
    });

    const sharedRow = await tx.aiHubWorkspace.upsert({
      where: {
        tenantId_provider_path: {
          tenantId: session.tenantId,
          provider: AI_HUB_PROVIDER_CODEX,
          path: sharedPath,
        },
      },
      create: {
        tenantId: session.tenantId,
        provider: AI_HUB_PROVIDER_CODEX,
        name: "Common",
        path: sharedPath,
        type: AI_HUB_SHARED_TYPE,
      },
      update: { name: "Common", type: AI_HUB_SHARED_TYPE },
    });

    await tx.aiHubMemberWorkspace.createMany({
      data: [
        { userId: session.id, workspaceId: privateRow.id },
        { userId: session.id, workspaceId: sharedRow.id },
      ],
      skipDuplicates: true,
    });

    return [privateRow, sharedRow];
  });

  return [
    { name: privateWorkspace.name, path: privateWorkspace.path },
    { name: sharedWorkspace.name, path: sharedWorkspace.path },
  ];
}

export async function listAiHubWorkspacesForMember(
  tenantId: string,
  userId: string,
  provider = AI_HUB_PROVIDER_CODEX,
): Promise<AiHubWorkspaceListItem[]> {
  const rows = await prisma.aiHubMemberWorkspace.findMany({
    where: {
      userId,
      workspace: { tenantId, provider },
    },
    select: {
      workspace: {
        select: { name: true, path: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    name: row.workspace.name,
    path: row.workspace.path,
  }));
}
