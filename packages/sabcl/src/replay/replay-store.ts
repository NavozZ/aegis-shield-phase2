/**
 * Replay protection.
 *
 * A message identifier may be seen exactly once inside its validity window.
 * Because `exp` is bounded by SABCL_MAX_TTL_SECONDS, retention is bounded too:
 * the store only has to remember an identifier until the message it belongs to
 * would have expired anyway.
 *
 * The check must be atomic. Two concurrent copies of the same envelope racing
 * through `has()` then `remember()` would both be accepted, which is exactly
 * the duplicate-submission case that matters for a transfer. Implementations
 * therefore expose a single compare-and-set operation.
 */
export interface SabclReplayStore {
  /**
   * Records `messageId` and reports whether it was previously unseen.
   *
   * Returns true for the first caller and false for every subsequent caller
   * within the TTL. Must be atomic across processes.
   */
  remember(messageId: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Process-local replay store.
 *
 * Correct for unit tests and for a single-process deployment only: it cannot
 * see identifiers consumed by another router instance. Production deployments
 * use the Redis-backed store in the router service.
 */
export class InMemoryReplayStore implements SabclReplayStore {
  private readonly seen = new Map<string, number>();

  async remember(messageId: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    // Opportunistic sweep keeps the map bounded without a timer.
    for (const [key, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(key);
    }
    if (this.seen.has(messageId)) return false;
    this.seen.set(messageId, now + ttlSeconds * 1_000);
    return true;
  }

  /** Test helper: current tracked count. */
  size(): number {
    return this.seen.size;
  }
}
