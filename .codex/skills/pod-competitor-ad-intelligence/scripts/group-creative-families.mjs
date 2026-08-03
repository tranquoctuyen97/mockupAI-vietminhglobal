function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeCopy(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(now|today)\b/g, '').trim();
}

export function groupCreativeFamilies(observations) {
  const groups = new Map();
  for (const observation of observations || []) {
    const key = fnv1a(`${normalizeCopy(observation.copy?.primaryText)}|${observation.destination?.finalDomain || ''}`);
    const group = groups.get(key) || { familyId: `fam_${key}`, observations: [], platforms: new Set() };
    group.observations.push(observation);
    group.platforms.add(observation.platform);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, platforms: [...group.platforms].sort() }))
    .sort((a, b) => b.observations.length - a.observations.length || a.familyId.localeCompare(b.familyId));
}
