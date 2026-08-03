#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { normalizeInputFiles } from './validate-input.mjs';

export { normalizeInputFiles };

async function main() {
  const [outputPath, ...inputPaths] = process.argv.slice(2);
  if (!outputPath || !inputPaths.length) {
    throw new TypeError('Usage: normalize-input.mjs <output.jsonl> <signals.jsonl> [more.jsonl...]');
  }
  const result = await normalizeInputFiles(inputPaths);
  const jsonl = result.records.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(outputPath, jsonl ? `${jsonl}\n` : '', 'utf8');
  process.stdout.write(`${JSON.stringify(result.manifest)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
