export function writeCompetitorReport(input) {
  const claims = [];
  const domain = input.competitor?.canonicalDomain || 'unknown competitor';
  const ads = input.adObservations || [];
  const changes = input.changes || [];

  claims.push({ type: 'observed', text: `${ads.length} public ad observations were provided for ${domain}.`, evidenceIds: ads.map((ad) => ad.observationId).filter(Boolean) });
  claims.push({ type: 'observed', text: `${changes.length} change records were derived from the provided snapshots.`, evidenceIds: changes.flatMap((change) => change.evidenceIds || []) });
  claims.push({ type: 'inference', text: 'Repeated hooks and destinations may indicate a reusable creative angle, but platform targeting and business outcome are not observable here.', evidenceIds: ads.map((ad) => ad.observationId).filter(Boolean) });

  const rows = ads.map((ad) => `| ${ad.platform} | ${ad.copy?.primaryText || ''} | ${ad.destination?.finalDomain || ''} | ${ad.observationId || ''} |`).join('\n');
  const markdown = [
    `# Competitor Ad Report: ${domain}`,
    '',
    '## Coverage',
    `Ad observations: ${ads.length}`,
    `Changes: ${changes.length}`,
    '',
    '## Observed',
    ...claims.filter((claim) => claim.type === 'observed').map((claim) => `- ${claim.text} Evidence: ${claim.evidenceIds.join(', ') || 'none'}`),
    '',
    '| Platform | Copy | Destination | Evidence |',
    '|---|---|---|---|',
    rows || '| none |  |  |  |',
    '',
    '## Inference',
    ...claims.filter((claim) => claim.type === 'inference').map((claim) => `- ${claim.text} Evidence: ${claim.evidenceIds.join(', ') || 'none'}`),
    '',
    '## Caveats',
    '- Public ad libraries do not expose exact targeting, budget, attributed revenue, or business outcome.',
    '- Missing ads in one run are treated as missing in that run only, not inactive.',
  ].join('\n');

  return {
    markdown,
    manifest: {
      schemaVersion: 'pod-competitor-report/v1',
      generatedAt: new Date().toISOString(),
      claimCount: claims.length,
      observationCount: ads.length,
      changeCount: changes.length,
    },
  };
}
