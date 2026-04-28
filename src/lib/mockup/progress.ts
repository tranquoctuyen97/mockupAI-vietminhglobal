export type MockupImageOutcome = "completed" | "failed";
export type MockupJobStatus = "pending" | "running" | "completed" | "failed";

export interface ComputeMockupProgressInput {
  totalImages: number;
  completedImages: number;
  failedImages: number;
  existingImageStatus: string;
  outcome: MockupImageOutcome;
  isFinalAttempt: boolean;
}

export interface ComputedMockupProgress {
  shouldCount: boolean;
  completedImages: number;
  failedImages: number;
  status: MockupJobStatus;
}

export function isFinalBullMqAttempt(
  attemptsMade: number,
  maxAttempts?: number,
): boolean {
  const attempts = maxAttempts ?? 1;
  return attemptsMade + 1 >= attempts;
}

export function computeMockupProgressAfterOutcome(
  input: ComputeMockupProgressInput,
): ComputedMockupProgress {
  let completedImages = input.completedImages;
  let failedImages = input.failedImages;
  let shouldCount = false;

  if (!isTerminalImageStatus(input.existingImageStatus)) {
    if (input.outcome === "completed") {
      completedImages += 1;
      shouldCount = true;
    } else if (input.isFinalAttempt) {
      failedImages += 1;
      shouldCount = true;
    }
  }

  const finishedImages = completedImages + failedImages;
  const status =
    finishedImages >= input.totalImages
      ? failedImages > 0
        ? "failed"
        : "completed"
      : "running";

  return {
    shouldCount,
    completedImages,
    failedImages,
    status,
  };
}

export function isTerminalImageStatus(status: string): boolean {
  return status === "completed" || status === "failed";
}

export function shouldSkipMockupImageProcessing(
  image: { compositeStatus: string } | null,
): boolean {
  return !image || isTerminalImageStatus(image.compositeStatus);
}
