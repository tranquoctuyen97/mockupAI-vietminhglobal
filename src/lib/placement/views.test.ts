import assert from "node:assert/strict";
import test from "node:test";
import { PLACEMENT_PRESETS } from "./presets";
import { DEFAULT_PLACEMENT, type PlacementData } from "./types";
import {
  disablePlacementView,
  enablePlacementView,
  formatPlacementViewCount,
  formatPlacementViewDetails,
  getEnabledViews,
  getPlacementForView,
  getPlacementViewLabels,
  normalizePlacementData,
  setPlacementForView,
} from "./views";

test("full_back preset belongs to the back view", () => {
  const fullBack = PLACEMENT_PRESETS.find((preset) => preset.key === "full_back");

  assert.equal(fullBack?.view, "back");
});

test("setPlacementForView updates back without overwriting front", () => {
  const initial = normalizePlacementData({
    version: "2.1",
    variants: {
      _default: {
        front: { ...DEFAULT_PLACEMENT, xMm: 11 },
        back: null,
      },
    },
  }, false);

  const next = setPlacementForView(initial, "back", { ...DEFAULT_PLACEMENT, xMm: 22 });

  assert.equal(getPlacementForView(next, "front")?.xMm, 11);
  assert.equal(getPlacementForView(next, "back")?.xMm, 22);
  assert.deepEqual(getEnabledViews(next), ["front", "back"]);
});

test("enable and disable placement views produce a full v2.1 shape", () => {
  const data = enablePlacementView(normalizePlacementData(null, false), "neck_label");
  const disabled = disablePlacementView(data, "neck_label");

  assert.equal(data.version, "2.1");
  assert.ok(data.variants._default);
  assert.equal(getPlacementForView(data, "neck_label")?.placementMode, "preserve");
  assert.deepEqual(getEnabledViews(disabled), []);
  assert.deepEqual(Object.keys(disabled.variants._default).sort(), [
    "back",
    "front",
    "hem",
    "neck_label",
    "sleeve_left",
    "sleeve_right",
  ].sort());
});

test("normalizing a variant-key placement keeps first available variant views", () => {
  const data: PlacementData = {
    version: "2.1",
    variants: {
      "123": {
        front: { ...DEFAULT_PLACEMENT, xMm: 33 },
        hem: { ...DEFAULT_PLACEMENT, xMm: 44 },
      },
    },
  };

  const normalized = normalizePlacementData(data, false);

  assert.equal(getPlacementForView(normalized, "front")?.xMm, 33);
  assert.equal(getPlacementForView(normalized, "hem")?.xMm, 44);
});

test("placement summary helpers split compact count from detailed labels", () => {
  let data = normalizePlacementData(null, false);
  data = setPlacementForView(data, "front", DEFAULT_PLACEMENT);
  data = setPlacementForView(data, "back", { ...DEFAULT_PLACEMENT, xMm: 12 });
  data = setPlacementForView(data, "sleeve_left", { ...DEFAULT_PLACEMENT, xMm: 22 });
  data = setPlacementForView(data, "sleeve_right", { ...DEFAULT_PLACEMENT, xMm: 32 });

  assert.equal(formatPlacementViewCount(data), "4 vị trí");
  assert.equal(formatPlacementViewDetails(data), "Mặt trước, Mặt sau, Tay trái, Tay phải");
  assert.deepEqual(getPlacementViewLabels(data), ["Mặt trước", "Mặt sau", "Tay trái", "Tay phải"]);
});

test("placement summary helpers handle empty placement data", () => {
  const data = normalizePlacementData(null, false);

  assert.equal(formatPlacementViewCount(data), "Chưa cấu hình");
  assert.equal(formatPlacementViewDetails(data), "Chưa có vị trí in nào được bật");
  assert.deepEqual(getPlacementViewLabels(data), []);
});
