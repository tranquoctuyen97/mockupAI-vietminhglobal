import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeInputFiles,
  validateJsonlText,
} from '../scripts/validate-input.mjs';

function signal(overrides = {}) {
  return {
    schemaVersion: 'pod-keyword-signal/v1',
    keywordId: 'kw_1',
    keyword: 'nurse shirt',
    aliases: ['nurse shirt'],
    firstSeenAt: '2026-07-23T00:00:00.000Z',
    lastSeenAt: '2026-07-31T00:00:00.000Z',
    sourceSummary: { sourceCount: 1, observationCount: 1, sources: ['etsy-autocomplete'] },
    weekly: [],
    platformSignals: {
      autocomplete: null,
      googleTrends: null,
      etsyMarketplace: null,
      tiktok: null,
      metaAds: null,
    },
    provenance: [{
      observationId: 'obs_1',
      source: 'etsy-autocomplete',
      query: 'nurse',
      sourceUrl: 'https://www.etsy.com/search?q=nurse',
      capturedAt: '2026-07-31T00:00:00.000Z',
    }],
    quality: { completeness: 0.5, warnings: [], hasCanonicalProvenance: true },
    ...overrides,
  };
}

test('reports exact line and field for malformed JSONL', () => {
  const text = `${JSON.stringify(signal())}\n{"schemaVersion":"pod-keyword-signal/v2"}`;
  const result = validateJsonlText(text, 'input.jsonl');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /input\.jsonl:2/);
  assert.match(result.errors[0], /schemaVersion/);
  assert.match(result.errors[0], /migration/i);
});

test('multiple input files merge duplicate keyword IDs by provenance deterministically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pod-skill-'));
  const firstPath = join(dir, 'a.jsonl');
  const secondPath = join(dir, 'b.jsonl');
  await writeFile(firstPath, `${JSON.stringify(signal())}\n`);
  await writeFile(secondPath, `${JSON.stringify(signal({
    provenance: [{
      observationId: 'obs_2',
      source: 'google-trends',
      query: 'nurse shirt',
      sourceUrl: 'https://trends.google.com/trends/explore?geo=US&q=nurse%20shirt',
      capturedAt: '2026-07-31T01:00:00.000Z',
    }],
  }))}\n`);

  const first = await normalizeInputFiles([secondPath, firstPath]);
  const second = await normalizeInputFiles([firstPath, secondPath]);
  assert.deepEqual(first.records, second.records);
  assert.equal(first.records.length, 1);
  assert.deepEqual(first.records[0].provenance.map((item) => item.observationId), ['obs_1', 'obs_2']);
  assert.equal(first.manifest.recordCount, 1);
  assert.equal(first.manifest.schemaVersions[0], 'pod-keyword-signal/v1');
  assert.match(first.manifest.sha256, /^[a-f0-9]{64}$/);
});
