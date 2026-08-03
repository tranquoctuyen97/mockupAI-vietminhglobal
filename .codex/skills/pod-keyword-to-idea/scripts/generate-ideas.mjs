function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const CONCEPTS = {
  'text-led': {
    label: 'Original phrase system',
    hook: (facets) => `Build an original ${facets.emotion} phrase using real ${facets.audience} vocabulary.`,
    visualDirection: 'Typography-led composition with one small supporting symbol.',
    typography: 'High-legibility display face paired with a restrained secondary face.',
  },
  'illustration-led': {
    label: 'Visual metaphor',
    hook: (facets) => `Express ${facets.audience} identity through an original visual metaphor.`,
    visualDirection: 'One ownable central illustration; avoid tracing or marketplace lookalikes.',
    typography: null,
  },
  personalization: {
    label: 'Personalized identity',
    hook: (facets) => `Let the buyer personalize the ${facets.audience} identity without changing the core composition.`,
    visualDirection: 'Reserved personalization zone integrated into the main design.',
    typography: 'Readable name and year treatment that supports variable length.',
  },
  'gift-occasion': {
    label: 'Gift moment',
    hook: (facets) => `Frame the concept around the ${facets.occasion} handoff from buyer to recipient.`,
    visualDirection: 'Gift-ready composition with occasion cues and recipient-first language.',
    typography: 'Warm headline plus a clear occasion detail.',
  },
  'identity-insider': {
    label: 'Insider recognition',
    hook: (facets) => `Use an original insider cue that a real ${facets.audience} recognizes immediately.`,
    visualDirection: 'Community-specific symbol system without brands, characters, or copied slogans.',
    typography: 'Confident badge or emblem structure.',
  },
};

function conceptsFor(facets) {
  const concepts = ['identity-insider'];
  if (facets.emotion === 'humor') concepts.push('text-led');
  else concepts.push('illustration-led');
  if (facets.personalization) concepts.push('personalization');
  if (facets.occasion) concepts.push('gift-occasion');
  return [...new Set(concepts)];
}

function scoreVector(cluster) {
  const sourceCount = cluster.provenanceSummary?.sources?.length || 0;
  return {
    sourceDiversity: Math.min(5, sourceCount),
    recency: 3,
    purchaseIntent: cluster.facets.buyer === 'gift-giver' ? 3 : 2,
    marketplaceEvidence: cluster.provenanceSummary?.sources?.some((source) => /etsy/i.test(source)) ? 3 : 0,
    trendSustainability: 2,
    buyerClarity: cluster.facets.buyer ? 4 : 0,
    productFit: cluster.facets.product ? 4 : 0,
    creativeDepth: 4,
    risk: cluster.reviewFlags?.length ? 3 : 1,
  };
}

export function validateIdeaContract(idea) {
  const errors = [];
  const requiredStrings = [
    'schemaVersion', 'ideaId', 'status', 'title', 'clusterId', 'audience',
    'buyer', 'wearerOrUser', 'emotion', 'conceptType', 'generatedAt',
  ];
  requiredStrings.forEach((field) => {
    if (typeof idea?.[field] !== 'string' || !idea[field]) errors.push(`${field} is required`);
  });
  if (idea?.schemaVersion !== 'pod-idea-card/v1') errors.push('schemaVersion is unsupported');
  if (!Array.isArray(idea?.seedKeywordIds) || !idea.seedKeywordIds.length) errors.push('seedKeywordIds is required');
  if (!Array.isArray(idea?.productTypes) || !idea.productTypes.length) errors.push('productTypes is required');
  if (!idea?.creativeBrief?.hook || !idea?.creativeBrief?.visualDirection) errors.push('creativeBrief is incomplete');
  if (!Array.isArray(idea?.evidence?.supportingKeywordIds) || !idea.evidence.supportingKeywordIds.length) {
    errors.push('evidence.supportingKeywordIds is required');
  }
  if (!Array.isArray(idea?.evidence?.sourceTypes) || !idea.evidence.sourceTypes.length) {
    errors.push('evidence.sourceTypes is required');
  }
  if (!idea?.scores || !idea?.gates || !Array.isArray(idea?.rejectionReasons)) {
    errors.push('scores, gates, and rejectionReasons are required');
  }
  return errors;
}

export function generateIdeas(clusters, { generatedAt = new Date().toISOString() } = {}) {
  const ideas = [];
  for (const cluster of clusters || []) {
    for (const conceptType of conceptsFor(cluster.facets)) {
      const definition = CONCEPTS[conceptType];
      const product = cluster.facets.product || 'product-review-required';
      const personalizationFields = conceptType === 'personalization' ? ['name', 'year-or-role'] : [];
      const idea = {
        schemaVersion: 'pod-idea-card/v1',
        ideaId: `idea_${fnv1a(`${cluster.clusterId}|${conceptType}`)}`,
        status: 'hypothesis',
        title: `${cluster.facets.audience}: ${definition.label}`,
        clusterId: cluster.clusterId,
        seedKeywordIds: [...cluster.memberKeywordIds],
        audience: cluster.facets.audience,
        buyer: cluster.facets.buyer || 'buyer-review-required',
        wearerOrUser: cluster.facets.wearerOrUser || cluster.facets.audience,
        occasion: cluster.facets.occasion,
        emotion: cluster.facets.emotion,
        productTypes: [product],
        conceptType,
        creativeBrief: {
          hook: definition.hook(cluster.facets),
          visualDirection: definition.visualDirection,
          typography: definition.typography,
          personalizationFields,
          avoid: ['named brands', 'characters', 'copied slogans', 'copied artwork'],
        },
        evidence: {
          supportingKeywordIds: [...cluster.memberKeywordIds],
          sourceTypes: [...(cluster.provenanceSummary?.sources || [])],
          reasons: [
            `observed: keywords ${cluster.memberKeywords.join(', ')} (${cluster.memberKeywordIds.join(', ')}) share the ${cluster.facets.audience} audience.`,
            `inference: ${conceptType} is a distinct creative mechanic for this intent.`,
            'recommendation: validate the concept with compliant marketplace and buyer evidence.',
          ],
          caveats: [...(cluster.reviewFlags || [])],
        },
        scores: scoreVector(cluster),
        gates: {
          ipRisk: cluster.reviewFlags?.includes('ip-phrase-review') ? 'review' : 'pass',
          sensitiveContent: cluster.reviewFlags?.includes('sensitive-content-review') ? 'review' : 'pass',
          buyerClarity: cluster.facets.buyer ? 'pass' : 'fail',
          productFit: cluster.facets.product ? 'pass' : 'fail',
          creativeDepth: 'pass',
          singleSourceTrend:
            (cluster.provenanceSummary?.sources?.length || 0) > 1 ? 'pass' : 'review',
          purchaseIntent: 'review',
        },
        rejectionReasons: [],
        generatedAt,
      };
      const errors = validateIdeaContract(idea);
      if (errors.length) throw new TypeError(`Invalid idea ${idea.ideaId}: ${errors.join('; ')}`);
      ideas.push(idea);
    }
  }
  return ideas.sort((a, b) => a.ideaId.localeCompare(b.ideaId));
}
