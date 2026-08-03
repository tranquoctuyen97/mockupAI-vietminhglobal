import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeRunArtifacts } from '../scripts/write-run-artifacts.mjs';

function idea(ideaId, status, reason = null) {
  return {
    ideaId,
    status,
    title: `Title ${ideaId}`,
    audience: 'nurse',
    buyer: 'self-or-gift',
    wearerOrUser: 'nurse',
    productTypes: ['shirt'],
    evidence: { sourceTypes: ['etsy-marketplace', 'google-trends'], caveats: [] },
    rejectionReasons: reason ? [reason] : [],
  };
}

test('writer creates all seven artifacts atomically with reconciled counts', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'pod-run-'));
  const result = await writeRunArtifacts({
    outputRoot,
    runId: 'run_fixture',
    inputManifest: { sha256: 'abc', recordCount: 2 },
    normalizedKeywords: [{ keywordId: 'kw_1' }, { keywordId: 'kw_2' }],
    clusters: [{ clusterId: 'cluster_1', memberKeywordIds: ['kw_1', 'kw_2'] }],
    ideas: [
      idea('idea_a', 'research-qualified'),
      idea('idea_b', 'hypothesis'),
      idea('idea_c', 'rejected', 'IP hard gate'),
    ],
    generatedAt: '2026-07-31T03:00:00.000Z',
    skillVersion: '1.0.0',
  });

  const files = (await readdir(result.runDir)).sort();
  assert.deepEqual(files, [
    'clusters.jsonl',
    'idea-candidates.jsonl',
    'idea-rejected.jsonl',
    'idea-shortlist.md',
    'input-manifest.json',
    'normalized-keywords.jsonl',
    'run-manifest.json',
  ]);

  const manifest = JSON.parse(await readFile(join(result.runDir, 'run-manifest.json'), 'utf8'));
  assert.equal(manifest.counts.shortlisted + manifest.counts.candidateOnly + manifest.counts.rejected, 3);
  assert.equal(manifest.counts.generated, 3);
  assert.equal(manifest.rejectedReasons['IP hard gate'], 1);

  const report = await readFile(join(result.runDir, 'idea-shortlist.md'), 'utf8');
  assert.match(report, /Data coverage/);
  assert.match(report, /IP hard gate/);
  assert.match(report, /validation/i);
});

test('same deterministic fixture preserves IDs and counts across runs', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'pod-run-'));
  const base = {
    outputRoot,
    inputManifest: { sha256: 'abc', recordCount: 1 },
    normalizedKeywords: [{ keywordId: 'kw_1' }],
    clusters: [{ clusterId: 'cluster_1', memberKeywordIds: ['kw_1'] }],
    ideas: [idea('idea_a', 'hypothesis')],
    generatedAt: '2026-07-31T03:00:00.000Z',
    skillVersion: '1.0.0',
  };
  const first = await writeRunArtifacts({ ...base, runId: 'run_one' });
  const second = await writeRunArtifacts({ ...base, runId: 'run_two' });
  const one = JSON.parse(await readFile(join(first.runDir, 'run-manifest.json'), 'utf8'));
  const two = JSON.parse(await readFile(join(second.runDir, 'run-manifest.json'), 'utf8'));
  assert.deepEqual(one.counts, two.counts);
  assert.equal(one.ideaIds[0], two.ideaIds[0]);
});
