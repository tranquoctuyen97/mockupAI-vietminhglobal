export interface WizardBlockingLoaderState {
  loading: boolean;
  hasDraft: boolean;
}

export function shouldShowWizardBlockingLoader({
  loading,
  hasDraft,
}: WizardBlockingLoaderState): boolean {
  return loading && !hasDraft;
}
