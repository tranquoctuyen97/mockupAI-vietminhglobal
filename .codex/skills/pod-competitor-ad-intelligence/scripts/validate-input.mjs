import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const AD_SCHEMA_VERSION = 'pod-competitor-ad/v1';

function validateAd(record) {
  const errors = [];
  if (record.schemaVersion !== AD_SCHEMA_VERSION) errors.push('schemaVersion');
  for (const field of ['observationId', 'competitorId', 'identityId', 'identityConfidence', 'platform', 'advertiserName', 'sourceUrl', 'capturedAt', 'platformStatus']) {
    if (record[field] == null || record[field] === '') errors.push(field);
  }
  if (!record.copy || typeof record.copy !== 'object') errors.push('copy');
  if (!record.destination || typeof record.destination !== 'object') errors.push('destination');
  if (!Array.isArray(record.warnings)) errors.push('warnings');
  return errors;
}

async function readJsonl(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

export async function validateRunFolder(folder) {
  const records = [];
  const errors = [];
  const fileName = 'ad-observations.jsonl';
  const text = await readJsonl(join(folder, fileName));
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (_error) {
      errors.push(`${fileName}:${index + 1}: invalid JSON`);
      continue;
    }
    const recordErrors = validateAd(record);
    if (recordErrors.length) {
      errors.push(`${fileName}:${index + 1}: ${recordErrors.join(', ')}`);
      continue;
    }
    records.push(record);
  }
  return { ok: errors.length === 0, errors, records };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await validateRunFolder(process.argv[2] || process.cwd());
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, records: result.records.length }));
}
