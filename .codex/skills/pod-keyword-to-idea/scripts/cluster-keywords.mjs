#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function has(text, expression) {
  return expression.test(text);
}

export function classifyFacets(keyword) {
  const text = String(keyword || '').toLowerCase().trim();
  const audience = has(text, /\bnurs(?:e|ing|es)\b/) ? 'nurse'
    : has(text, /\bdog(?:\s+(?:mom|dad|lover|owner))?\b/) ? 'dog-lover'
      : has(text, /\bmama\b|\bmom\b|\bmother\b/) ? 'mom'
        : 'general';
  const occasion = has(text, /\bgraduat(?:e|ion)\b/) ? 'graduation'
    : has(text, /\bmemorial\b|\bin memory\b|\bremembrance\b/) ? 'memorial'
      : has(text, /\bbirthday\b/) ? 'birthday'
        : has(text, /\bchristmas\b|\bxmas\b/) ? 'christmas'
          : null;
  const emotion = has(text, /\bfunny\b|\bhumou?r\b|\bjoke\b|\bsarcastic\b/) ? 'humor'
    : occasion === 'memorial' ? 'remembrance'
      : has(text, /\bproud\b|\blove\b/) ? 'pride-love'
        : 'identity';
  const product = has(text, /\bshirts?\b|\btees?\b|\bt-?shirts?\b/) ? 'shirt'
    : has(text, /\bsweatshirts?\b|\bhoodies?\b/) ? 'sweatshirt'
      : has(text, /\bmugs?\b/) ? 'mug'
        : has(text, /\btumblers?\b/) ? 'tumbler'
          : null;
  const personalization = has(text, /\bcustom\b|\bpersonalized?\b|\bname\b|\byear\b/);
  const buyer = has(text, /\bgifts?\b/) ? 'gift-giver' : 'self-or-gift';
  const style = has(text, /\bretro\b|\bvintage\b/) ? 'retro'
    : has(text, /\bminimal(?:ist)?\b/) ? 'minimal'
      : null;

  return {
    audience,
    buyer,
    wearerOrUser: audience,
    occasion,
    emotion,
    style,
    product,
    personalization,
    sensitivity: occasion === 'memorial' ? 'grief-memorial' : null,
  };
}

function signatureFor(facets) {
  return [
    facets.audience,
    facets.buyer,
    facets.occasion || 'evergreen',
    facets.emotion,
    facets.style || 'any-style',
    facets.product || 'product-unclear',
    facets.personalization ? 'personalized' : 'fixed',
  ].join('|');
}

function flagsFor(keyword, facets) {
  const flags = [];
  if (/\bmama bear\b/i.test(keyword)) flags.push('ip-phrase-review');
  if (facets.sensitivity) flags.push('sensitive-content-review');
  if (facets.audience === 'general' || !facets.product) flags.push('ambiguous-intent-review');
  return flags;
}

function platformSources(signal) {
  const sources = [];
  const platform = signal.platformSignals || {};
  if (platform.etsyMarketplace) sources.push('etsy-marketplace');
  if (platform.googleTrends) sources.push('google-trends');
  if (Array.isArray(platform.tiktok)) {
    platform.tiktok.forEach((item) => sources.push(item.sourceType || 'tiktok'));
  }
  if (Array.isArray(platform.metaAds) && platform.metaAds.length) sources.push('meta-ad-library');
  return sources;
}

export function clusterKeywords(signals) {
  const groups = new Map();
  [...(signals || [])]
    .sort((a, b) => a.keywordId.localeCompare(b.keywordId))
    .forEach((signal) => {
      const facets = classifyFacets(signal.keyword);
      const signature = signatureFor(facets);
      const group = groups.get(signature) || { facets, members: [] };
      group.members.push(signal);
      groups.set(signature, group);
    });

  return [...groups.entries()].map(([signature, group]) => {
    const memberKeywordIds = group.members.map((item) => item.keywordId).sort();
    const sources = [...new Set(group.members.flatMap((item) =>
      [
        ...(item.sourceSummary?.sources || item.provenance?.map((entry) => entry.source) || []),
        ...platformSources(item),
      ]))].sort();
    const observationIds = [...new Set(group.members.flatMap((item) =>
      item.provenance?.map((entry) => entry.observationId) || []))].sort();
    const reviewFlags = [...new Set(group.members.flatMap((item) =>
      flagsFor(item.keyword, group.facets)))].sort();

    return {
      clusterId: `cluster_${fnv1a(signature)}`,
      signature,
      facets: group.facets,
      memberKeywordIds,
      memberKeywords: group.members.map((item) => item.keyword).sort(),
      provenanceSummary: { sources, observationIds },
      ambiguous: reviewFlags.includes('ambiguous-intent-review'),
      reviewFlags,
      clusterReason: `Shared ${group.facets.audience} audience with ${group.facets.emotion} / ${group.facets.occasion || 'evergreen'} intent.`,
    };
  }).sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}

async function main() {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) throw new TypeError('Usage: cluster-keywords.mjs <normalized-keywords.jsonl>');
  const records = (await readFile(inputPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const output = clusterKeywords(records).map((cluster) => JSON.stringify(cluster)).join('\n');
  process.stdout.write(output ? `${output}\n` : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
