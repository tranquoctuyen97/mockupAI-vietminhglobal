/**
 * Auto-place a design into a Printify print area at a listing-ready default size.
 *
 * This produces a smaller, chest-positioned artwork placement *inside* the print
 * area — it never changes the print area (the max printable boundary) itself.
 * Aspect ratio is preserved and the result is clamped inside the print area.
 */

import {
  buildDefaultPlacementFromRatio,
  type PlacementDesignSize,
  type ProductTypeInput,
  resolvePlacementProfile,
} from "./profile";
import type { Placement, PlacementData, PrintArea, ViewKey } from "./types";
import { createEmptyPlacementData, setPlacementForView } from "./views";

export interface AutoPlaceInput {
  design: PlacementDesignSize;
  printArea: PrintArea;
  /** Template-ish info used to pick a product-type tuned profile. */
  template?: ProductTypeInput;
  /** View to place into. Defaults to "front". */
  view?: ViewKey;
}

/**
 * Compute a listing-ready placement (top-left mm) for a single view.
 */
export function autoPlace(input: AutoPlaceInput): Placement {
  const view = input.view ?? "front";
  const profile = resolvePlacementProfile(input.template ?? {}, view);
  return buildDefaultPlacementFromRatio({
    printArea: input.printArea,
    design: input.design,
    profile,
  });
}

export interface BuildListingReadyPlacementDataInput {
  design: PlacementDesignSize;
  printArea: PrintArea;
  template?: ProductTypeInput;
  /** Views to populate. Defaults to ["front"]. */
  views?: ViewKey[];
}

/**
 * Build a full PlacementData with listing-ready defaults for the given views.
 * Used as a fallback when a draft has no placement override and the template has
 * no saved default placement.
 */
export function buildListingReadyPlacementData(
  input: BuildListingReadyPlacementDataInput,
): PlacementData {
  const views = input.views && input.views.length > 0 ? input.views : ["front" as ViewKey];
  let data = createEmptyPlacementData();
  for (const view of views) {
    const placement = autoPlace({
      design: input.design,
      printArea: input.printArea,
      template: input.template,
      view,
    });
    data = setPlacementForView(data, view, placement);
  }
  return data;
}
