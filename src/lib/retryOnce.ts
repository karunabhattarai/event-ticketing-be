// Retries a single time on failure, per the spec's "may retry once" guidance for
// Fonepay status-check calls — a transient network blip shouldn't immediately
// count as a hard failure when a single retry would likely succeed.
export async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}
