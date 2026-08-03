#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 'pod-keyword-signal/v1';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateSignal(record) {
  const errors = [];
  if (!isObject(record)) return ['record must be an object'];
  if (record.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}; run an explicit migration for other versions`);
  }
  if (typeof record.keywordId !== 'string' || !record.keywordId) errors.push('keywordId is required');
  if (typeof record.keyword !== 'string' || !record.keyword) errors.push('keyword is required');
  if (!Array.isArray(record.aliases)) errors.push('aliases must be an array');
  if (!Number.isFinite(Date.parse(record.firstSeenAt))) errors.push('firstSeenAt must be an ISO timestamp');
  if (!Number.isFinite(Date.parse(record.lastSeenAt))) errors.push('lastSeenAt must be an ISO timestamp');
  if (!isObject(record.sourceSummary)) errors.push('sourceSummary must be an object');
  if (!Array.isArray(record.weekly)) errors.push('weekly must be an array');
  if (!isObject(record.platformSignals)) errors.push('platformSignals must be an object');
  if (!Array.isArray(record.provenance) || !record.provenance.length) {
    errors.push('provenance must contain at least one entry');
  } else {
    record.provenance.forEach((item, index) => {
      if (!item?.observationId) errors.push(`provenance[${index}].observationId is required`);
      if (!item?.source) errors.push(`provenance[${index}].source is required`);
      if (!item?.sourceUrl) errors.push(`provenance[${index}].sourceUrl is required`);
      if (!Number.isFinite(Date.parse(item?.capturedAt))) {
        errors.push(`provenance[${index}].capturedAt must be an ISO timestamp`);
      }
    });
  }
  if (!isObject(record.quality) || !Array.isArray(record.quality?.warnings)) {
    errors.push('quality.warnings must be an array');
  }
  return errors;
}

export function validateJsonlText(text, label = '<input>') {
  const records = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      errors.push(`${label}:${index + 1}: invalid JSON: ${error.message}`);
      return;
    }
    const recordErrors = validateSignal(record);
    if (recordErrors.length) {
      recordErrors.forEach((error) => errors.push(`${label}:${index + 1}: ${error}`));
      return;
    }
    records.push(record);
  });
  return { ok: errors.length === 0, records, errors };
}

function mergeSignals(left, right) {
  const provenance = new Map();
  [...left.provenance, ...right.provenance].forEach((item) => provenance.set(item.observationId, item));
  const aliases = [...new Set([...left.aliases, ...right.aliases])].sort();
  const warnings = [...new Set([
    ...(left.quality?.warnings || []),
    ...(right.quality?.warnings || []),
  ])].sort();
  const sources = [...new Set([
    ...(left.sourceSummary?.sources || []),
    ...(right.sourceSummary?.sources || []),
  ])].sort();
  const orderedProvenance = [...provenance.values()]
    .sort((a, b) => a.observationId.localeCompare(b.observationId));

  return {
    ...left,
    aliases,
    firstSeenAt: left.firstSeenAt < right.firstSeenAt ? left.firstSeenAt : right.firstSeenAt,
    lastSeenAt: left.lastSeenAt > right.lastSeenAt ? left.lastSeenAt : right.lastSeenAt,
    sourceSummary: {
      sourceCount: sources.length,
      observationCount: orderedProvenance.length,
      sources,
    },
    weekly: [...new Map(
      [...left.weekly, ...right.weekly]
        .sort((a, b) => a.week.localeCompare(b.week))
        .map((week) => [week.week, week]),
    ).values()],
    platformSignals: Object.fromEntries(
      Object.keys(left.platformSignals).sort().map((key) => [
        key,
        right.platformSignals[key] ?? left.platformSignals[key] ?? null,
      ]),
    ),
    provenance: orderedProvenance,
    quality: {
      completeness: Math.max(left.quality?.completeness || 0, right.quality?.completeness || 0),
      warnings,
      hasCanonicalProvenance:
        !!left.quality?.hasCanonicalProvenance || !!right.quality?.hasCanonicalProvenance,
    },
  };
}

export async function normalizeInputFiles(paths) {
  const orderedPaths = [...new Set(paths)].sort();
  const contents = await Promise.all(orderedPaths.map(async (path) => ({
    path,
    text: await readFile(path, 'utf8'),
  })));
  const errors = [];
  const merged = new Map();
  for (const input of contents) {
    const result = validateJsonlText(input.text, input.path);
    errors.push(...result.errors);
    for (const record of result.records) {
      const current = merged.get(record.keywordId);
      merged.set(record.keywordId, current ? mergeSignals(current, record) : record);
    }
  }
  if (errors.length) throw new TypeError(errors.join('\n'));

  const records = [...merged.values()].sort((a, b) => a.keywordId.localeCompare(b.keywordId));
  const hash = createHash('sha256');
  contents.forEach((input) => hash.update(input.text).update('\u001e'));
  return {
    records,
    manifest: {
      sha256: hash.digest('hex'),
      recordCount: records.length,
      inputFileCount: contents.length,
      schemaVersions: [...new Set(records.map((record) => record.schemaVersion))].sort(),
    },
  };
}

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new TypeError('Usage: validate-input.mjs <signals.jsonl> [more.jsonl...]');
  const output = await normalizeInputFiles(paths);
  process.stdout.write(`${JSON.stringify(output.manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
