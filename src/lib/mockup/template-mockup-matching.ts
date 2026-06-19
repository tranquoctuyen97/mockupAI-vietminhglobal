import { chooseTemplateMockupsForColor, readAppliesToColorIds } from "@/lib/mockup/global-library";

export interface TemplateMockupForMatching {
  id: string;
  appliesToColorIds: unknown;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface ExistingPickForMatching {
  id: string;
  templateMockupItemId: string;
  colorId: string;
  compositeRegionPx: unknown;
}

export function findMissingMockupColorIds(
  selectedColorIds: string[],
  templateMockupItems: TemplateMockupForMatching[],
): string[] {
  return selectedColorIds.filter((colorId) => chooseTemplateMockupsForColor(templateMockupItems, colorId).length === 0);
}

export function buildTemplateMockupPickPlan(params: {
  selectedColorIds: string[];
  templateMockupItems: TemplateMockupForMatching[];
  existingPicks: ExistingPickForMatching[];
}) {
  const existingByKey = new Map(params.existingPicks.map((pick) => [pickKey(pick.templateMockupItemId, pick.colorId), pick]));
  const desiredKeys = new Set<string>();
  const create: Array<{ templateMockupItemId: string; colorId: string; sortOrder: number; isPrimary: boolean }> = [];
  const update: Array<{ id: string; sortOrder: number; isPrimary: boolean; compositeRegionPx: unknown }> = [];

  for (const colorId of params.selectedColorIds) {
    const matches = chooseTemplateMockupsForColor(params.templateMockupItems, colorId);
    for (const match of matches) {
      const key = pickKey(match.id, colorId);
      desiredKeys.add(key);
      const existing = existingByKey.get(key);
      if (existing) {
        update.push({ id: existing.id, sortOrder: match.sortOrder, isPrimary: match.isPrimary, compositeRegionPx: existing.compositeRegionPx });
      } else {
        create.push({ templateMockupItemId: match.id, colorId, sortOrder: match.sortOrder, isPrimary: match.isPrimary });
      }
    }
  }

  const deleteIds = params.existingPicks
    .filter((pick) => !desiredKeys.has(pickKey(pick.templateMockupItemId, pick.colorId)))
    .map((pick) => pick.id);

  return { create, update, deleteIds };
}

function pickKey(templateMockupItemId: string, colorId: string): string {
  return `${templateMockupItemId}:${colorId}`;
}
