const SCORE_FIELDS = [
  'sourceDiversity',
  'recency',
  'purchaseIntent',
  'marketplaceEvidence',
  'trendSustainability',
  'buyerClarity',
  'productFit',
  'creativeDepth',
  'risk',
];

const NAMED_IP_RE = /\b(disney|marvel|pokemon|star wars|nike|adidas|nfl|nba|mlb|nhl|taylor swift|barbie|harry potter)\b/i;
const MEDICAL_CLAIM_RE = /\b(cures?|heals?|treats?|prevents?|guaranteed recovery)\b/i;
const SENSITIVE_RE = /\b(memorial|grief|cancer|autism|religion|christian|muslim|democrat|republican|election|kids?|children)\b/i;
const SOCIAL_RE = /^(tiktok|reddit|pinterest|youtube|x-|instagram)/i;
const MARKETPLACE_RE = /etsy-marketplace|etsyMarketplace|marketplace-purchase/i;

export function validateScoreVector(scores) {
  const errors = [];
  for (const field of SCORE_FIELDS) {
    const value = scores?.[field];
    if (!Number.isFinite(value) || value < 0 || value > 5) {
      errors.push(`scores.${field} must be between 0 and 5`);
    }
  }
  return errors;
}

function ideaText(idea) {
  return [
    idea.title,
    idea.audience,
    idea.creativeBrief?.hook,
    idea.creativeBrief?.visualDirection,
    ...(idea.creativeBrief?.avoid || []),
    ...(idea.evidence?.reasons || []),
  ].join(' ');
}

export function evaluateIdea(input) {
  const idea = structuredClone(input);
  const text = ideaText(idea);
  const sources = [...new Set(idea.evidence?.sourceTypes || [])];
  const onlySocial = sources.length > 0 && sources.every((source) => SOCIAL_RE.test(source));
  const hasMarketplace = sources.some((source) => MARKETPLACE_RE.test(source));
  const hasIndependentEvidence = sources.some((source) =>
    !MARKETPLACE_RE.test(source) && !/^meta-ad-library$/i.test(source));
  const exactCopy = idea.evidence?.caveats?.includes('exact-artwork-copy');
  const suspiciousPhrase = idea.evidence?.caveats?.includes('ip-phrase-review');

  const gates = {
    ipRisk: NAMED_IP_RE.test(text) || exactCopy ? 'fail' : (suspiciousPhrase ? 'review' : 'pass'),
    sensitiveContent: MEDICAL_CLAIM_RE.test(text) ? 'fail' : (SENSITIVE_RE.test(text) ? 'review' : 'pass'),
    buyerClarity: !idea.buyer || /review-required|unclear/i.test(idea.buyer) ? 'fail' : 'pass',
    productFit: !idea.productTypes?.length || idea.productTypes.some((item) => /review-required/i.test(item))
      ? 'fail' : 'pass',
    creativeDepth: !idea.creativeBrief?.hook || !idea.creativeBrief?.visualDirection ? 'fail' : 'pass',
    singleSourceTrend: sources.length === 1 && SOCIAL_RE.test(sources[0]) ? 'review' : 'pass',
    purchaseIntent: hasMarketplace ? 'pass' : (onlySocial ? 'review' : 'fail'),
  };

  const rejectionReasons = [];
  if (gates.ipRisk === 'fail') rejectionReasons.push('IP/copyright hard gate failed');
  if (gates.sensitiveContent === 'fail') rejectionReasons.push('Sensitive-content hard gate failed');
  if (gates.buyerClarity === 'fail') rejectionReasons.push('Buyer is unclear');
  if (gates.productFit === 'fail') rejectionReasons.push('Product fit is unclear');
  if (gates.creativeDepth === 'fail') rejectionReasons.push('Creative depth is insufficient');
  if (gates.purchaseIntent === 'fail') rejectionReasons.push('No purchase-intent or marketplace evidence');

  const hardFailure = Object.values(gates).includes('fail');
  const needsReview = Object.values(gates).includes('review');
  idea.gates = gates;
  idea.rejectionReasons = rejectionReasons;
  idea.status = hardFailure
    ? 'rejected'
    : (!needsReview && hasMarketplace && hasIndependentEvidence ? 'research-qualified' : 'hypothesis');
  return idea;
}

export function evaluateIdeas(ideas) {
  return (ideas || []).map(evaluateIdea).sort((a, b) => a.ideaId.localeCompare(b.ideaId));
}
