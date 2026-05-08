export interface PrintifyMediaRef {
  compositeUrl?: string | null;
  sourceUrl?: string | null;
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isSyntheticMockupSource(value: string): boolean {
  return value.startsWith("mockup://");
}

export function isDisallowedRemoteMockupUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "via.placeholder.com";
  } catch {
    return true;
  }
}

export function isLocalStorageMockupUrl(value: string | null | undefined): boolean {
  return !!value && !isRemoteUrl(value) && !isSyntheticMockupSource(value);
}

export function isAllowedRemoteMockupUrl(value: string | null | undefined): boolean {
  return !!value && isRemoteUrl(value) && !isDisallowedRemoteMockupUrl(value);
}

export function isRealPrintifyMockupMedia(image: PrintifyMediaRef): boolean {
  if (isAllowedRemoteMockupUrl(image.sourceUrl)) return true;
  if (isAllowedRemoteMockupUrl(image.compositeUrl)) return true;
  return isLocalStorageMockupUrl(image.compositeUrl) && isAllowedRemoteMockupUrl(image.sourceUrl);
}
