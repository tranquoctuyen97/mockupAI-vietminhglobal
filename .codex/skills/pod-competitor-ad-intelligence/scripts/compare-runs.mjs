function adKey(ad) {
  return `${ad.platform}:${ad.platformAdId || ad.observationId}`;
}

function latestSnapshot(run) {
  return (run.websiteSnapshots || []).at(-1) || null;
}

export function compareRuns(previous, current, options = {}) {
  const changes = [];
  const prevSnapshot = latestSnapshot(previous);
  const currentSnapshot = latestSnapshot(current);
  const prevProduct = prevSnapshot?.products?.[0];
  const currentProduct = currentSnapshot?.products?.[0];
  if (prevProduct && currentProduct && prevProduct.price?.value !== currentProduct.price?.value) {
    changes.push({
      type: 'price-change',
      product: currentProduct.name,
      from: prevProduct.price?.value ?? null,
      to: currentProduct.price?.value ?? null,
      evidenceIds: [prevSnapshot.snapshotId, currentSnapshot.snapshotId].filter(Boolean),
    });
  }
  if (prevSnapshot && currentSnapshot && prevSnapshot.offers?.popupOffer !== currentSnapshot.offers?.popupOffer) {
    changes.push({
      type: 'offer-change',
      from: prevSnapshot.offers?.popupOffer ?? null,
      to: currentSnapshot.offers?.popupOffer ?? null,
      evidenceIds: [prevSnapshot.snapshotId, currentSnapshot.snapshotId].filter(Boolean),
    });
  }

  const prevAds = new Map((previous.adObservations || []).map((ad) => [adKey(ad), ad]));
  const currentAds = new Map((current.adObservations || []).map((ad) => [adKey(ad), ad]));
  for (const [key, ad] of currentAds) {
    if (!prevAds.has(key)) changes.push({ type: 'new-ad', adKey: key, evidenceIds: [ad.observationId].filter(Boolean) });
    if ((options.previouslyMissingAdIds || []).includes(key)) changes.push({ type: 'ad-reappeared', adKey: key, evidenceIds: [ad.observationId].filter(Boolean) });
  }
  for (const [key, ad] of prevAds) {
    if (!currentAds.has(key)) changes.push({ type: 'ad-missing-this-run', adKey: key, inactive: false, evidenceIds: [ad.observationId].filter(Boolean) });
  }
  return changes;
}
