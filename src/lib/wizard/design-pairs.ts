import type { PairingResult } from "@/lib/designs/design-pairing";

export interface DraftDesignPairSource {
  id: string;
  designId: string;
}

export interface WizardDraftDesignPairRow {
  baseName: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
  sortOrder: number;
}

export interface StablePairKeySource {
  baseName: string;
  lightDraftDesignId: string;
  darkDraftDesignId: string;
}

export function stablePairKey(pair: StablePairKeySource): string {
  return `${pair.baseName}::${pair.lightDraftDesignId}::${pair.darkDraftDesignId}`;
}

export function buildPairRowsFromDraftDesigns({
  pairing,
  draftDesigns,
}: {
  pairing: Pick<PairingResult, "pairs">;
  draftDesigns: DraftDesignPairSource[];
}): WizardDraftDesignPairRow[] {
  const draftDesignIdByDesignId = new Map(
    draftDesigns.map((draftDesign) => [draftDesign.designId, draftDesign.id]),
  );

  return pairing.pairs.map((pair, sortOrder) => {
    const lightDraftDesignId = draftDesignIdByDesignId.get(pair.lightDesignId);
    const darkDraftDesignId = draftDesignIdByDesignId.get(pair.darkDesignId);

    if (!lightDraftDesignId || !darkDraftDesignId) {
      throw new Error("Pair references a design outside the draft selection");
    }

    return {
      baseName: pair.baseName,
      lightDraftDesignId,
      darkDraftDesignId,
      sortOrder,
    };
  });
}

export function assertPairingIsPublishable(pairing: PairingResult): void {
  // Only block when there are pair-intent designs missing their counterpart
  if (pairing.unpaired.length > 0) {
    throw new Error("Resolve unpaired light/dark designs before continuing");
  }

  // At least one design (independent or paired) is required
  if (pairing.pairs.length === 0 && pairing.independent.length === 0) {
    throw new Error("Select at least one design");
  }

  if (pairing.pairs.length > 40) {
    throw new Error("Select up to 40 design pairs");
  }
}
