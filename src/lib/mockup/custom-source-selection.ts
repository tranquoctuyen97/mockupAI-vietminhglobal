export interface CustomMockupSourceSelectionSource {
  id: string;
  isPrimary?: boolean;
  sortOrder?: number;
}

export interface CustomMockupSourceSelectionPick {
  sourceId: string;
  isPrimary?: boolean;
  sortOrder?: number;
}

export function resolveCustomMockupSourceSelection<T extends CustomMockupSourceSelectionSource>(input: {
  sources: T[];
  picks?: CustomMockupSourceSelectionPick[] | null;
}): {
  selectedSourceIds: string[];
  primarySourceId: string | null;
  selectedSources: Array<T & { isPrimary: boolean }>;
} {
  const sources = [...input.sources];
  const rawPicks = input.picks ?? [];
  const picks = rawPicks.filter((pick) => sources.some((source) => source.id === pick.sourceId));
  const hasExplicitSelection = rawPicks.length > 0;
  const selectedIds = hasExplicitSelection
    ? sources.filter((source) => picks.some((pick) => pick.sourceId === source.id)).map((source) => source.id)
    : sources.map((source) => source.id);

  const primarySourceId = resolvePrimarySourceId(sources, picks, selectedIds, hasExplicitSelection);

  return {
    selectedSourceIds: selectedIds,
    primarySourceId,
    selectedSources: sources
      .filter((source) => selectedIds.includes(source.id))
      .map((source) => ({
        ...source,
        isPrimary: source.id === primarySourceId,
      })),
  };
}

function resolvePrimarySourceId<T extends CustomMockupSourceSelectionSource>(
  sources: T[],
  picks: CustomMockupSourceSelectionPick[],
  selectedIds: string[],
  hasExplicitSelection: boolean,
): string | null {
  if (selectedIds.length === 0) return null;

  if (hasExplicitSelection) {
    const pickedPrimaryId = picks.find((pick) => pick.isPrimary)?.sourceId ?? null;
    if (pickedPrimaryId && selectedIds.includes(pickedPrimaryId)) {
      return pickedPrimaryId;
    }
  }

  const assetPrimary = sources.find((source) => source.isPrimary && selectedIds.includes(source.id));
  if (assetPrimary) return assetPrimary.id;

  return selectedIds[0] ?? null;
}
