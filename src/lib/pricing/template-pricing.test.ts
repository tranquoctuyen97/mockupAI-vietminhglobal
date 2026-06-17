import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMoneyValue,
  normalizePriceBySizeDefault,
  resolveBaseTemplatePrice,
  resolvePriceForSize,
} from "./template-pricing";

test("normalizeMoneyValue accepts positive finite values rounded to two decimals", () => {
  assert.equal(normalizeMoneyValue(24.999), 25);
  assert.equal(normalizeMoneyValue("27.994"), 27.99);
  assert.equal(normalizeMoneyValue("27.995"), 28);
});

test("normalizeMoneyValue rejects empty, zero, negative, and non-finite values", () => {
  assert.equal(normalizeMoneyValue(null), null);
  assert.equal(normalizeMoneyValue(""), null);
  assert.equal(normalizeMoneyValue(0), null);
  assert.equal(normalizeMoneyValue(-1), null);
  assert.equal(normalizeMoneyValue(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeMoneyValue("abc"), null);
});

test("normalizePriceBySizeDefault trims keys and rounds values", () => {
  assert.deepEqual(normalizePriceBySizeDefault({ " 2XL ": 27.995, "3XL": "29.994" }), {
    "2XL": 28,
    "3XL": 29.99,
  });
});

test("normalizePriceBySizeDefault returns null for invalid maps", () => {
  assert.equal(normalizePriceBySizeDefault(null), null);
  assert.equal(normalizePriceBySizeDefault({ "": 24.99 }), null);
  assert.equal(normalizePriceBySizeDefault({ XL: 0 }), null);
  assert.equal(normalizePriceBySizeDefault(["XL"]), null);
});

test("resolveBaseTemplatePrice uses template base before store default and fallback", () => {
  assert.equal(resolveBaseTemplatePrice({ templateBasePriceUsd: 25.5, storeDefaultPriceUsd: 30 }), 25.5);
  assert.equal(resolveBaseTemplatePrice({ templateBasePriceUsd: null, storeDefaultPriceUsd: "30.995" }), 31);
  assert.equal(resolveBaseTemplatePrice({ templateBasePriceUsd: null, storeDefaultPriceUsd: null }), 24.99);
});

test("resolvePriceForSize uses draft override before template per-size before base", () => {
  const params = {
    size: "2XL",
    draftPriceBySizeOverride: { "2XL": 31.111 },
    templatePriceBySizeDefault: { "2XL": 29.999 },
    templateBasePriceUsd: 24.99,
    storeDefaultPriceUsd: 21.99,
  };

  assert.equal(resolvePriceForSize(params), 31.11);
  assert.equal(resolvePriceForSize({ ...params, draftPriceBySizeOverride: null }), 30);
  assert.equal(
    resolvePriceForSize({
      ...params,
      draftPriceBySizeOverride: null,
      templatePriceBySizeDefault: null,
    }),
    24.99,
  );
});
