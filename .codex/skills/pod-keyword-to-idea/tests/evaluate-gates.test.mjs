import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateIdea, validateScoreVector } from '../scripts/evaluate-gates.mjs';

function idea(overrides = {}) {
  return {
    schemaVersion: 'pod-idea-card/v1',
    ideaId: 'idea_1',
    status: 'hypothesis',
    title: 'Nurse insider shirt',
    buyer: 'self-or-gift',
    wearerOrUser: 'nurse',
    audience: 'nurse',
    productTypes: ['shirt'],
    conceptType: 'identity-insider',
    creativeBrief: {
      hook: 'Original nurse insider phrase',
      visualDirection: 'Original badge',
      avoid: [],
    },
    evidence: {
      sourceTypes: ['etsy-marketplace', 'google-trends'],
      supportingKeywordIds: ['kw_1'],
      reasons: [],
      caveats: [],
    },
    scores: {
      sourceDiversity: 3,
      recency: 4,
      purchaseIntent: 3,
      marketplaceEvidence: 4,
      trendSustainability: 3,
      buyerClarity: 4,
      productFit: 4,
      creativeDepth: 4,
      risk: 1,
    },
    gates: {},
    rejectionReasons: [],
    ...overrides,
  };
}

test('high-trend franchise idea is hard rejected', () => {
  const result = evaluateIdea(idea({
    title: 'Disney nurse princess shirt',
    scores: { ...idea().scores, trendSustainability: 5 },
  }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.gates.ipRisk, 'fail');
  assert.match(result.rejectionReasons.join(' '), /IP/i);
});

test('Meta longevity cannot satisfy purchase-intent gate', () => {
  const result = evaluateIdea(idea({
    evidence: {
      sourceTypes: ['meta-ad-library', 'google-trends'],
      supportingKeywordIds: ['kw_1'],
      reasons: ['observed: ad ran for 40 days'],
      caveats: [],
    },
    scores: { ...idea().scores, marketplaceEvidence: 0, purchaseIntent: 1 },
  }));
  assert.notEqual(result.status, 'research-qualified');
  assert.equal(result.gates.purchaseIntent, 'fail');
});

test('single-source TikTok trend stays review-only', () => {
  const result = evaluateIdea(idea({
    evidence: {
      sourceTypes: ['tiktok-trending-video'],
      supportingKeywordIds: ['kw_1'],
      reasons: [],
      caveats: [],
    },
  }));
  assert.equal(result.status, 'hypothesis');
  assert.equal(result.gates.singleSourceTrend, 'review');
});

test('qualified idea requires marketplace plus independent evidence', () => {
  const result = evaluateIdea(idea());
  assert.equal(result.status, 'research-qualified');
  assert.ok(Object.values(result.gates).every((gate) => gate === 'pass'));
});

test('score vector is rubric-bounded from 0 to 5', () => {
  assert.deepEqual(validateScoreVector(idea().scores), []);
  assert.match(validateScoreVector({ ...idea().scores, risk: 8 }).join(' '), /risk/);
});
