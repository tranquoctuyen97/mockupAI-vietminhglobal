export const MAX_TAGS = 15;
export const MAX_ORGANIZATION_COLLECTIONS = 10;

const INTERNAL_TAG_DENYLIST = new Set(["mockupai", "draft-preview"]);

export function mergeOptimizedTags(aiTags: unknown[], currentTags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of [...aiTags, ...currentTags]) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (INTERNAL_TAG_DENYLIST.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(tag);

    if (out.length >= MAX_TAGS) break;
  }

  return out;
}

export function normalizeOrganizationCollections(
  values: unknown,
  max = MAX_ORGANIZATION_COLLECTIONS,
): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(value);

    if (out.length >= max) break;
  }

  return out;
}
