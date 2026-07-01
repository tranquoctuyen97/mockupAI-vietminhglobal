export function getAiHubInternalToken(): string | undefined {
  return process.env.AI_HUB_INTERNAL_TOKEN || undefined;
}

export function hasValidAiHubInternalAuth(authHeader: string): boolean {
  const expected = getAiHubInternalToken();
  return Boolean(expected && authHeader === `Bearer ${expected}`);
}
