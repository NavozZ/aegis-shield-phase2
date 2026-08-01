import { createClient, type RedisClientType } from 'redis';
import type { SabclReplayStore } from './replay-store.js';

/**
 * Redis-backed replay store, shared by the router and by every recipient.
 *
 * A recipient needs its own replay state, not just the router's. The router is
 * the cheap first gate, but nothing stops a message being delivered to a
 * recipient's `/sabcl/v1/inbound` directly by anything already on the internal
 * network. If the recipient trusted the router's check, that direct path would
 * have no replay protection at all.
 *
 * `SET NX EX` is one command, so the claim is atomic across processes: two
 * instances of the same recipient behind a load balancer cannot both accept a
 * duplicate.
 */
export class RedisReplayStore implements SabclReplayStore {
  private readonly client: RedisClientType;
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly url: string,
    private readonly prefix: string,
  ) {
    this.client = createClient({ url });
    // Connection errors must not become unhandled rejections. A failure to
    // reach Redis surfaces at `remember`, which fails closed.
    this.client.on('error', () => undefined);
  }

  async connect(): Promise<void> {
    if (this.client.isOpen) return;
    this.connecting ??= this.client.connect().then(() => undefined);
    await this.connecting;
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  async remember(messageId: string, ttlSeconds: number): Promise<boolean> {
    await this.connect();
    const result = await this.client.set(
      `${this.prefix}replay:${messageId}`,
      '1',
      { NX: true, EX: Math.max(1, ttlSeconds) },
    );
    return result === 'OK';
  }

  async ping(): Promise<boolean> {
    try {
      await this.connect();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
