import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareRuns } from '../scripts/compare-runs.mjs';
import { groupCreativeFamilies } from '../scripts/group-creative-families.mjs';
import { writeCompetitorReport } from '../scripts/write-report.mjs';

test('compare runs detects price, offer, new ad, missing and reappeared changes', () => {
  const previous = {
    websiteSnapshots: [{ products: [{ name: 'Teacher Shirt', price: { value: 24.99 } }], offers: { popupOffer: '10% off' } }],
    adObservations: [{ observationId: 'ad_old', platform: 'meta', platformAdId: '123', copy: { primaryText: 'Old hook' } }],
  };
  const current = {
    websiteSnapshots: [{ products: [{ name: 'Teacher Shirt', price: { value: 19.99 } }], offers: { popupOffer: '15% off' } }],
    adObservations: [
      { observationId: 'ad_old', platform: 'meta', platformAdId: '123', copy: { primaryText: 'Old hook' } },
      { observationId: 'ad_new', platform: 'google', platformAdId: 'g1', copy: { primaryText: 'New hook' } },
    ],
  };
  const changes = compareRuns(previous, current);
  assert.equal(changes.some((item) => item.type === 'price-change'), true);
  assert.equal(changes.some((item) => item.type === 'offer-change'), true);
  assert.equal(changes.some((item) => item.type === 'new-ad'), true);

  const missing = compareRuns(current, previous);
  assert.equal(missing.some((item) => item.type === 'ad-missing-this-run' && item.inactive === false), true);
  assert.equal(compareRuns(previous, current, { previouslyMissingAdIds: ['google:g1'] }).some((item) => item.type === 'ad-reappeared'), true);
});

test('creative families group by deterministic copy and destination hashes', () => {
  const families = groupCreativeFamilies([
    { platform: 'meta', platformAdId: '1', copy: { primaryText: 'Buy teacher shirts now!' }, destination: { finalDomain: 'example.com' } },
    { platform: 'google', platformAdId: '2', copy: { primaryText: 'Buy teacher shirts now' }, destination: { finalDomain: 'example.com' } },
    { platform: 'tiktok', platformAdId: '3', copy: { primaryText: 'Nurse humor tee' }, destination: { finalDomain: 'example.com' } },
  ]);
  assert.equal(families.length, 2);
  assert.equal(families[0].observations.length, 2);
});

test('report separates facts and inferences and never states spend or ROAS', () => {
  const report = writeCompetitorReport({
    competitor: { canonicalDomain: 'example.com' },
    adObservations: [{
      observationId: 'ad_1',
      platform: 'meta',
      copy: { primaryText: 'Teacher shirts are back' },
      destination: { finalDomain: 'example.com' },
      sourceUrl: 'https://www.facebook.com/ads/library/',
      capturedAt: '2026-07-31T00:00:00.000Z',
      warnings: [],
    }],
    changes: [{ type: 'new-ad', evidenceIds: ['ad_1'] }],
  });
  assert.match(report.markdown, /Observed/);
  assert.match(report.markdown, /Inference/);
  assert.equal(/ROAS|spend|profit/i.test(report.markdown), false);
  assert.equal(report.manifest.claimCount, 3);
});
