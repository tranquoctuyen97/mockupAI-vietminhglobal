import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function jsonl(records) {
  const text = (records || []).map((record) => JSON.stringify(record)).join('\n');
  return text ? `${text}\n` : '';
}

async function atomicWrite(path, content) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, path);
}

function countReasons(rejected) {
  const counts = {};
  rejected.flatMap((idea) => idea.rejectionReasons || []).forEach((reason) => {
    counts[reason] = (counts[reason] || 0) + 1;
  });
  return counts;
}

function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildReport({ normalizedKeywords, clusters, qualified, hypotheses, rejected }) {
  const ideaRows = qualified.map((idea) => [
    idea.status,
    idea.title,
    `${idea.buyer} / ${idea.wearerOrUser}`,
    idea.productTypes.join(', '),
    idea.evidence.sourceTypes.join(', '),
    idea.evidence.caveats?.join(', ') || 'none recorded',
    'Run IP check, listing test, and paid/organic demand validation.',
  ].map(cell).join(' | '));
  const rejectionLines = rejected.length
    ? rejected.map((idea) => `- ${idea.ideaId}: ${(idea.rejectionReasons || []).join('; ')}`).join('\n')
    : '- None.';

  return `# POD idea shortlist

## Executive summary

${qualified.length} research-qualified, ${hypotheses.length} hypothesis/review-only, and ${rejected.length} rejected ideas were retained in this run.

## Data coverage

- Keywords: ${normalizedKeywords.length}
- Clusters: ${clusters.length}
- Generated ideas: ${qualified.length + hypotheses.length + rejected.length}

## Top clusters

${clusters.slice(0, 10).map((cluster) =>
    `- ${cluster.clusterId}: ${(cluster.memberKeywords || cluster.memberKeywordIds || []).join(', ')}`).join('\n') || '- None.'}

## Idea table

Status | Idea | Buyer / wearer | Product | Evidence | Caveats | Next validation
---|---|---|---|---|---|---
${ideaRows.join('\n') || '—|No idea passed all gates|—|—|—|See rejected section|Collect stronger evidence'}

## Evidence and caveats

Observed inputs, inferences, and recommendations remain separate. Social attention and ad longevity are not purchase intent.

## Risks requiring checks

${rejectionLines}

## Validation next steps

1. Run official trademark/copyright and marketplace policy checks.
2. Validate buyer language and product fit with a listing or landing-page test.
3. Measure impressions, clicks, add-to-cart, and purchases before calling an idea commercially validated.
`;
}

export async function writeRunArtifacts({
  outputRoot,
  runId,
  inputManifest,
  normalizedKeywords,
  clusters,
  ideas,
  generatedAt,
  skillVersion,
}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new TypeError('runId contains unsafe characters');
  const runDir = join(outputRoot, runId);
  await mkdir(runDir, { recursive: true });

  const orderedIdeas = [...ideas].sort((a, b) => a.ideaId.localeCompare(b.ideaId));
  const qualified = orderedIdeas.filter((idea) => idea.status === 'research-qualified');
  const hypotheses = orderedIdeas.filter((idea) => idea.status === 'hypothesis');
  const rejected = orderedIdeas.filter((idea) => idea.status === 'rejected');
  const candidates = [...qualified, ...hypotheses].sort((a, b) => a.ideaId.localeCompare(b.ideaId));
  const manifest = {
    runId,
    schemaVersion: 'pod-idea-card/v1',
    skillVersion,
    generatedAt,
    inputSha256: inputManifest.sha256,
    counts: {
      normalizedKeywords: normalizedKeywords.length,
      clusters: clusters.length,
      generated: orderedIdeas.length,
      shortlisted: qualified.length,
      candidateOnly: hypotheses.length,
      rejected: rejected.length,
    },
    rejectedReasons: countReasons(rejected),
    ideaIds: orderedIdeas.map((idea) => idea.ideaId),
  };

  await Promise.all([
    atomicWrite(join(runDir, 'input-manifest.json'), `${JSON.stringify(inputManifest, null, 2)}\n`),
    atomicWrite(join(runDir, 'normalized-keywords.jsonl'), jsonl(normalizedKeywords)),
    atomicWrite(join(runDir, 'clusters.jsonl'), jsonl(clusters)),
    atomicWrite(join(runDir, 'idea-candidates.jsonl'), jsonl(candidates)),
    atomicWrite(join(runDir, 'idea-rejected.jsonl'), jsonl(rejected)),
    atomicWrite(join(runDir, 'idea-shortlist.md'), buildReport({
      normalizedKeywords,
      clusters,
      qualified,
      hypotheses,
      rejected,
    })),
    atomicWrite(join(runDir, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
  ]);

  return { runDir, manifest };
}
