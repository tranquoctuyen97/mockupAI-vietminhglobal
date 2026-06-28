import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatContentChecklistLabel,
  formatListingSummaryLabel,
  getIndependentDraftDesigns,
  getPairedDraftDesignIds,
  hasAiTitle,
} from "./publish-units";

describe("wizard publish units", () => {
  const draftDesigns = [
    { id: "dd-light", designId: "design-light", design: { id: "design-light", name: "Lion Light" } },
    { id: "dd-dark", designId: "design-dark", design: { id: "design-dark", name: "Lion Dark" } },
    { id: "dd-single", designId: "design-single", design: { id: "design-single", name: "Tiger" } },
  ];

  const designPairs = [
    { id: "pair-1", lightDraftDesignId: "dd-light", darkDraftDesignId: "dd-dark" },
  ];

  it("derives paired ids and independent draft designs", () => {
    assert.deepEqual([...getPairedDraftDesignIds(designPairs)].sort(), ["dd-dark", "dd-light"]);
    assert.deepEqual(getIndependentDraftDesigns(draftDesigns, designPairs).map((d) => d.id), [
      "dd-single",
    ]);
  });

  it("formats mixed labels", () => {
    assert.equal(formatListingSummaryLabel(2, 3), "5 listings (2 cặp, 3 đơn)");
    assert.equal(formatListingSummaryLabel(2, 0), "2 listings (2 cặp)");
    assert.equal(formatListingSummaryLabel(0, 3), "3 listings (3 đơn)");
    assert.equal(formatContentChecklistLabel(2, 3), "Nội dung đầy đủ cho 2 cặp + 3 đơn");
  });

  it("treats unmatched suffix designs as independent publish units", () => {
    const unmatchedDraftDesigns = [
      { id: "dd-dark", designId: "design-dark", design: { id: "design-dark", name: "Lion Dark" } },
      { id: "dd-single", designId: "design-single", design: { id: "design-single", name: "Tiger" } },
    ];

    assert.deepEqual(
      getIndependentDraftDesigns(unmatchedDraftDesigns, []).map((design) => design.id),
      ["dd-dark", "dd-single"],
    );
  });

  it("checks ai title safely", () => {
    assert.equal(hasAiTitle({ title: " Ready " }), true);
    assert.equal(hasAiTitle({ title: " " }), false);
    assert.equal(hasAiTitle(null), false);
  });
});
