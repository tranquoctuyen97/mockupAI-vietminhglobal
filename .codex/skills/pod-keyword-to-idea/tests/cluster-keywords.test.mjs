import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFacets, clusterKeywords } from '../scripts/cluster-keywords.mjs';

function signal(keywordId, keyword, sources = ['etsy-autocomplete']) {
  return {
    keywordId,
    keyword,
    aliases: [keyword],
    sourceSummary: { sources },
    provenance: sources.map((source, index) => ({
      observationId: `${keywordId}_${index}`,
      source,
    })),
  };
}

test('broad, humor, and graduation intent remain separate but related', () => {
  const clusters = clusterKeywords([
    signal('kw_1', 'nurse shirt'),
    signal('kw_2', 'funny nurse shirt'),
    signal('kw_3', 'nurse graduation gift'),
  ]);

  assert.equal(clusters.length, 3);
  assert.equal(new Set(clusters.map((cluster) => cluster.facets.audience)).size, 1);
  assert.ok(clusters.some((cluster) => cluster.facets.emotion === 'humor'));
  assert.ok(clusters.some((cluster) => cluster.facets.occasion === 'graduation'));
  assert.ok(clusters.every((cluster) => cluster.clusterReason));
});

test('personalization and memorial sensitivity survive classification', () => {
  const facets = classifyFacets('custom dog memorial shirt');
  assert.equal(facets.personalization, true);
  assert.equal(facets.occasion, 'memorial');
  assert.equal(facets.sensitivity, 'grief-memorial');
  assert.equal(facets.product, 'shirt');
});

test('suspicious slogan and provenance summary are retained for review', () => {
  const [cluster] = clusterKeywords([
    signal('kw_mama', 'mama bear', ['etsy-autocomplete', 'tiktok']),
  ]);
  assert.equal(cluster.reviewFlags.includes('ip-phrase-review'), true);
  assert.deepEqual(cluster.memberKeywordIds, ['kw_mama']);
  assert.deepEqual(cluster.provenanceSummary.sources, ['etsy-autocomplete', 'tiktok']);
});

test('clustering is deterministic regardless of input order', () => {
  const inputs = [
    signal('kw_b', 'funny nurse shirt'),
    signal('kw_a', 'nurse shirt'),
  ];
  assert.deepEqual(clusterKeywords(inputs), clusterKeywords([...inputs].reverse()));
});
