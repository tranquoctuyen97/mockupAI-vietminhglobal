import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateRunFolder } from '../scripts/validate-input.mjs';

test('validates competitor ad JSONL and reports line errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pod-competitor-'));
  try {
    await writeFile(join(dir, 'ad-observations.jsonl'), `${JSON.stringify({
      schemaVersion: 'pod-competitor-ad/v1',
      observationId: 'ad_1',
      competitorId: 'cmp_example_com',
      identityId: 'id_1',
      identityConfidence: 'high',
      platform: 'meta',
      advertiserName: 'Example',
      sourceUrl: 'https://www.facebook.com/ads/library/',
      capturedAt: '2026-07-31T00:00:00.000Z',
      platformStatus: 'active',
      copy: { primaryText: 'Teacher shirts', headline: null, description: null, callToAction: null },
      destination: { finalDomain: 'example.com' },
      warnings: [],
    })}\n{"schemaVersion":"unknown"}\n`);

    const result = await validateRunFolder(dir);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /ad-observations\.jsonl:2/);
    assert.equal(result.records.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
