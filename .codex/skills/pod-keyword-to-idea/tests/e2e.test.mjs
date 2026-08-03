import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeInputFiles, validateJsonlText } from '../scripts/validate-input.mjs';
import { clusterKeywords } from '../scripts/cluster-keywords.mjs';
import { generateIdeas } from '../scripts/generate-ideas.mjs';
import { evaluateIdeas } from '../scripts/evaluate-gates.mjs';
import { writeRunArtifacts } from '../scripts/write-run-artifacts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures/e2e-signals.jsonl');

test('JSONL to seven run artifacts preserves risks, evidence, and declining history', async () => {
  const normalized = await normalizeInputFiles([fixturePath, fixturePath]);
  assert.equal(normalized.records.length, 3);
  const nurse = normalized.records.find((record) => record.keywordId === 'kw_nurse');
  assert.ok(nurse.weekly[1].demand < nurse.weekly[0].demand);
  assert.equal(nurse.platformSignals.etsyMarketplace.competition.isLowerBound, true);

  const clusters = clusterKeywords(normalized.records);
  const generated = generateIdeas(clusters, { generatedAt: '2026-07-31T04:00:00.000Z' });
  const evaluated = evaluateIdeas(generated);
  assert.ok(evaluated.some((idea) => idea.status === 'research-qualified'));
  assert.ok(evaluated.some((idea) =>
    idea.status === 'rejected' && idea.rejectionReasons.some((reason) => /IP/.test(reason))));
  assert.ok(evaluated.some((idea) =>
    idea.status === 'hypothesis' && idea.gates.singleSourceTrend === 'review'));

  const outputRoot = await mkdtemp(join(tmpdir(), 'pod-e2e-'));
  const result = await writeRunArtifacts({
    outputRoot,
    runId: 'run_e2e',
    inputManifest: normalized.manifest,
    normalizedKeywords: normalized.records,
    clusters,
    ideas: evaluated,
    generatedAt: '2026-07-31T04:00:00.000Z',
    skillVersion: '1.0.0',
  });
  assert.equal((await readdir(result.runDir)).length, 7);
  const allOutput = await Promise.all((await readdir(result.runDir))
    .map((file) => readFile(join(result.runDir, file), 'utf8')));
  assert.doesNotMatch(allOutput.join('\n'), /cookie|authorization|access_token/i);
});

test('corrupt line fails closed with line number', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pod-e2e-bad-'));
  const badPath = join(dir, 'bad.jsonl');
  await writeFile(badPath, '{"schemaVersion":"pod-keyword-signal/v1"}\nnot-json\n');
  await assert.rejects(() => normalizeInputFiles([badPath]), /bad\.jsonl:1: keywordId/);
  const direct = validateJsonlText('not-json', 'broken.jsonl');
  assert.match(direct.errors[0], /broken\.jsonl:1/);
});
