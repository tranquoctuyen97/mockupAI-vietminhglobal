import {
  DEFAULT_PLACEMENT,
  VIEW_KEYS,
  type Placement,
  type PlacementData,
  type PlacementForView,
  type VariantViews,
  type ViewKey,
} from "./types";

export const DEFAULT_VARIANT_KEY = "_default";

export const VIEW_LABELS: Record<ViewKey, string> = {
  front: "Mặt trước",
  back: "Mặt sau",
  sleeve_left: "Tay trái",
  sleeve_right: "Tay phải",
  neck_label: "Nhãn cổ",
  hem: "Gấu áo",
};

export const VIEW_SHORT_LABELS: Record<ViewKey, string> = {
  front: "Front",
  back: "Back",
  sleeve_left: "L sleeve",
  sleeve_right: "R sleeve",
  neck_label: "Neck",
  hem: "Hem",
};

/**
 * Translate a raw view position string (e.g. from DB) to Vietnamese label.
 * Accepts any string — safe for user-facing render.
 */
export function viewLabel(pos: string): string {
  return VIEW_LABELS[pos as ViewKey] ?? pos;
}

export function clonePlacementData(data: PlacementData): PlacementData {
  return JSON.parse(JSON.stringify(data)) as PlacementData;
}

export function createEmptyPlacementData(): PlacementData {
  return {
    version: "2.1",
    variants: {
      [DEFAULT_VARIANT_KEY]: emptyVariantViews(),
    },
  };
}

export function createPlacementDataWithFront(): PlacementData {
  return setPlacementForView(
    createEmptyPlacementData(),
    "front",
    createDefaultPlacementForView("front"),
  );
}

export function normalizePlacementData(raw: unknown, fallbackFront = true): PlacementData {
  if (!raw || typeof raw !== "object") {
    return fallbackFront ? createPlacementDataWithFront() : createEmptyPlacementData();
  }

  const candidate = raw as Partial<PlacementData>;
  const variants = candidate.variants && typeof candidate.variants === "object"
    ? candidate.variants
    : {};
  const variantKey = pickVariantKey(variants);
  const sourceViews = variantKey ? variants[variantKey] : undefined;
  const views = emptyVariantViews();

  for (const view of VIEW_KEYS) {
    views[view] = coercePlacement(sourceViews?.[view]) as PlacementForView | null;
  }

  const hasAnyView = VIEW_KEYS.some((view) => Boolean(views[view]));
  if (!hasAnyView && fallbackFront) {
    views.front = createDefaultPlacementForView("front");
  }

  return {
    version: candidate.version === 2 || candidate.version === "2.1" ? candidate.version : "2.1",
    variants: {
      [DEFAULT_VARIANT_KEY]: views,
    },
  };
}

export function getDefaultVariantViews(data: PlacementData): VariantViews {
  return data.variants[DEFAULT_VARIANT_KEY]
    ?? data.variants.default
    ?? data.variants[Object.keys(data.variants)[0]]
    ?? emptyVariantViews();
}

export function getEnabledViews(data: PlacementData | null | undefined): ViewKey[] {
  if (!data) return [];
  const views = getDefaultVariantViews(data);
  return VIEW_KEYS.filter((view) => Boolean(views[view]));
}

export function getPlacementViewLabels(data: PlacementData | null | undefined): string[] {
  return getEnabledViews(data).map((view) => VIEW_LABELS[view]);
}

export function formatPlacementViewCount(data: PlacementData | null | undefined): string {
  const count = getEnabledViews(data).length;
  return count > 0 ? `${count} vị trí` : "Chưa cấu hình";
}

export function formatPlacementViewDetails(data: PlacementData | null | undefined): string {
  const labels = getPlacementViewLabels(data);
  return labels.length > 0 ? labels.join(", ") : "Chưa có vị trí in nào được bật";
}

export function getPlacementForView(
  data: PlacementData | null | undefined,
  view: ViewKey,
): PlacementForView | null {
  if (!data) return null;
  return getDefaultVariantViews(data)[view] ?? null;
}

export function setPlacementForView(
  data: PlacementData,
  view: ViewKey,
  placement: Placement | PlacementForView | null,
): PlacementData {
  const next = normalizePlacementData(data, false);
  next.variants[DEFAULT_VARIANT_KEY][view] = placement
    ? ({ ...placement } as PlacementForView)
    : null;
  return next;
}

export function patchPlacementForView(
  data: PlacementData,
  view: ViewKey,
  patch: Partial<Placement>,
): PlacementData {
  const current = getPlacementForView(data, view) ?? createDefaultPlacementForView(view);
  return setPlacementForView(data, view, { ...current, ...patch });
}

export function enablePlacementView(
  data: PlacementData,
  view: ViewKey,
  placement?: Partial<Placement>,
): PlacementData {
  const current = getPlacementForView(data, view);
  return setPlacementForView(data, view, {
    ...(current ?? createDefaultPlacementForView(view)),
    ...placement,
  });
}

export function disablePlacementView(data: PlacementData, view: ViewKey): PlacementData {
  return setPlacementForView(data, view, null);
}

export function createDefaultPlacementForView(view: ViewKey): Placement {
  const defaultsByView: Record<ViewKey, Partial<Placement>> = {
    front: { xMm: 77.8, yMm: 78.2, widthMm: 200, heightMm: 250 },
    back: { xMm: 77.8, yMm: 78.2, widthMm: 200, heightMm: 250 },
    sleeve_left: { xMm: 0, yMm: 120, widthMm: 70, heightMm: 90 },
    sleeve_right: { xMm: 0, yMm: 120, widthMm: 70, heightMm: 90 },
    neck_label: { xMm: 0, yMm: 36, widthMm: 55, heightMm: 35 },
    hem: { xMm: 0, yMm: 340, widthMm: 80, heightMm: 45 },
  };

  return {
    ...DEFAULT_PLACEMENT,
    ...defaultsByView[view],
    presetKey: undefined,
  };
}

export function summarizePlacementViews(data: PlacementData | null | undefined): string {
  const enabledViews = getEnabledViews(data);
  if (enabledViews.length === 0) return "Chưa cấu hình";
  return `${enabledViews.length} vị trí: ${enabledViews.map((view) => VIEW_LABELS[view]).join(", ")}`;
}

function emptyVariantViews(): VariantViews {
  return {
    front: null,
    back: null,
    sleeve_left: null,
    sleeve_right: null,
    neck_label: null,
    hem: null,
  };
}

function pickVariantKey(variants: PlacementData["variants"]): string | null {
  if (variants[DEFAULT_VARIANT_KEY]) return DEFAULT_VARIANT_KEY;
  if (variants.default) return "default";
  return Object.keys(variants)[0] ?? null;
}

function coercePlacement(value: unknown): PlacementForView | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PlacementForView>;
  if (
    typeof candidate.xMm !== "number" ||
    typeof candidate.yMm !== "number" ||
    typeof candidate.widthMm !== "number" ||
    typeof candidate.heightMm !== "number"
  ) {
    return null;
  }

  return {
    xMm: candidate.xMm,
    yMm: candidate.yMm,
    widthMm: candidate.widthMm,
    heightMm: candidate.heightMm,
    rotationDeg: typeof candidate.rotationDeg === "number" ? candidate.rotationDeg : 0,
    lockAspect: candidate.lockAspect ?? true,
    placementMode: candidate.placementMode ?? "preserve",
    mirrored: candidate.mirrored ?? false,
    presetKey: candidate.presetKey,
    imageOverrides: candidate.imageOverrides,
  };
}
