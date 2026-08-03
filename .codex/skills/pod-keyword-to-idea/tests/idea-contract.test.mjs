import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateIdeas, validateIdeaContract } from '../scripts/generate-ideas.mjs';

const cluster = {
  clusterId: 'cluster_nurse',
  facets: {
    audience: 'nurse',
    buyer: 'self-or-gift',
    wearerOrUser: 'nurse',
    occasion: null,
    emotion: 'humor',
    style: null,
    product: 'shirt',
    personalization: false,
    sensitivity: null,
  },
  memberKeywordIds: ['kw_1', 'kw_2'],
  memberKeywords: ['nurse shirt', 'funny nurse shirt'],
  provenanceSummary: { sources: ['etsy-autocomplete', 'google-trends'] },
  reviewFlags: [],
};

test('generated cards satisfy required buyer, product, evidence, and claim-level contract', () => {
  const ideas = generateIdeas([cluster], {
    generatedAt: '2026-07-31T02:00:00.000Z',
  });
  assert.ok(ideas.length >= 2);
  ideas.forEach((idea) => assert.deepEqual(validateIdeaContract(idea), []));
  assert.ok(ideas.every((idea) => idea.buyer && idea.wearerOrUser));
  assert.ok(ideas.every((idea) => idea.productTypes.length));
  assert.ok(ideas.every((idea) => idea.evidence.supportingKeywordIds.length));
  assert.ok(ideas.every((idea) => idea.evidence.reasons.every((reason) =>
    /^(observed|inference|recommendation):/.test(reason))));
});

test('two ideas from one cluster use different concept mechanics, not title variants', () => {
  const ideas = generateIdeas([cluster], {
    generatedAt: '2026-07-31T02:00:00.000Z',
  });
  assert.equal(new Set(ideas.map((idea) => idea.conceptType)).size, ideas.length);
  assert.equal(new Set(ideas.map((idea) => idea.creativeBrief.hook)).size, ideas.length);
});

test('generator never creates revenue forecasts or mock metrics', () => {
  const [idea] = generateIdeas([cluster], {
    generatedAt: '2026-07-31T02:00:00.000Z',
  });
  const serialized = JSON.stringify(idea);
  assert.doesNotMatch(serialized, /revenue|salesForecast|mockMetric/i);
});
