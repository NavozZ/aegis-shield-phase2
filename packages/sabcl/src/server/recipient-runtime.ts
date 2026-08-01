import { capabilitiesForService } from '../catalog/capabilities.js';
import {
  loadSabclEnvironment,
  type SabclEnvironment,
} from '../config/environment.js';
import { SabclError } from '../protocol/errors.js';
import { RedisReplayStore } from '../replay/redis-replay-store.js';
import { createLoopbackDispatcher } from './loopback-dispatch.js';
import {
  SabclRecipient,
  type SabclRecipientOutcome,
} from './sabcl-recipient.js';

/*
 * One place that turns environment variables into a working recipient.
 *
 * Identity, Ledger and Payments all need the same thing: read the SABCL
 * environment, take the capabilities the catalogue says they own, put a Redis
 * replay store behind them, and dispatch onto their own HTTP surface. Doing it
 * here means the three services cannot drift into three slightly different
 * security postures.
 */

export interface SabclRecipientRuntimeOptions {
  /** Service name; selects capabilities from the catalogue. */
  service: string;
  /** Environment variable prefix, e.g. `SABCL_LEDGER`. */
  environmentPrefix: string;
  /** This service's own base URL, for loopback dispatch. */
  selfUrl: string;
  /** This service's own internal token. */
  internalToken: string;
  nodeEnvironment: string;
  redisUrl: string;
  redisPrefix: string;
  dispatchTimeoutMs: number;
  /** Reads environment variables. Injected in tests. */
  environment?: Record<string, string | undefined>;
}

export interface SabclRecipientRuntime {
  environment: SabclEnvironment;
  recipient: SabclRecipient;
  replayStore: RedisReplayStore;
  handle: (envelope: unknown) => Promise<SabclRecipientOutcome>;
  ready: () => Promise<boolean>;
  shutdown: () => Promise<void>;
}

/**
 * Builds the runtime, or returns null when SABCL_MODE=off.
 *
 * Returning null rather than throwing is what lets a service run with SABCL
 * disabled and keep its existing behaviour untouched. Every other failure —
 * missing key, bad peer list, unparseable route secret — throws, so a
 * misconfigured strict deployment cannot start.
 */
export function createSabclRecipientRuntime(
  options: SabclRecipientRuntimeOptions,
): SabclRecipientRuntime | null {
  const env = options.environment ?? process.env;
  const read = (suffix: string): string | undefined =>
    env[`${options.environmentPrefix}_${suffix}`];

  const environment = loadSabclEnvironment({
    mode: env.SABCL_MODE,
    keyId: read('KEY_ID'),
    encryptionPrivateKey: read('ENCRYPTION_PRIVATE_KEY'),
    signingPrivateKey: read('SIGNING_PRIVATE_KEY'),
    peers: env.SABCL_PEERS,
    routeSecret: env.SABCL_ROUTE_SECRET,
    nodeEnvironment: options.nodeEnvironment,
  });
  if (!environment) return null;

  if (environment.keyring.own.service !== options.service) {
    // A gateway key configured on the ledger would authenticate the wrong
    // service and silently accept traffic meant for someone else.
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      `${options.environmentPrefix}_KEY_ID names ${environment.keyring.own.service}, expected ${options.service}`,
    );
  }

  const capabilities = capabilitiesForService(options.service);
  if (capabilities.length === 0) {
    throw new SabclError(
      'SABCL_NOT_CONFIGURED',
      `no SABCL capabilities are defined for ${options.service}`,
    );
  }

  const replayStore = new RedisReplayStore(
    options.redisUrl,
    options.redisPrefix,
  );
  const recipient = new SabclRecipient({
    keyring: environment.keyring,
    replayStore,
    capabilities,
    dispatch: createLoopbackDispatcher({
      baseUrl: options.selfUrl,
      internalToken: options.internalToken,
      timeoutMs: options.dispatchTimeoutMs,
    }),
  });

  return {
    environment,
    recipient,
    replayStore,
    handle: (envelope) => recipient.handle(envelope),
    ready: () => replayStore.ping(),
    shutdown: () => replayStore.disconnect(),
  };
}
