export const MAX_REFERENCE_RETRY_ATTEMPTS = 5;
export const INITIAL_REFERENCE_RETRY_DELAY_MS = 5000;

export function getReferenceRetryDelayMs(
  attempt: number,
): number {
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt >= MAX_REFERENCE_RETRY_ATTEMPTS
  ) {
    throw new Error('Invalid retry attempt');
  }

  return (
    INITIAL_REFERENCE_RETRY_DELAY_MS *
    2 ** (attempt - 1)
  );
}
