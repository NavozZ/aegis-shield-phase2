import {
  SabclRouteTable,
  loadSabclEnvironment,
  type SabclEnvironment,
  type SabclRoute,
} from '@aegis/sabcl';
import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

/*
 * PORT SELECTION
 *
 * Reserved elsewhere in this repository at the time of writing:
 *   3000 web, 4000 API gateway, 4101 identity, 4102 ledger,
 *   4104 payments, 4105 threat detection (reserved in .env.example),
 *   4318 OTLP, 5432 PostgreSQL, 6379 Redis, 9090 metrics.
 *
 * 4103 is the unclaimed gap between the ledger and payments services and is not
 * referenced anywhere in .env.example, infra/scripts/stack.mjs or the CI
 * workflow. The router therefore takes 4103. Documented in
 * services/sabcl-router/README.md and .env.example.
 */
export const SABCL_ROUTER_DEFAULT_PORT = 4103;

export interface RouterConfig {
  nodeEnvironment: string;
  host: string;
  port: number;
  redisUrl: string;
  redisKeyPrefix: string;
  /** Upper bound on a forwarded request, independent of the sender's timeout. */
  forwardTimeoutMs: number;
  /** Envelopes accepted per sender key per window. */
  rateLimitPerMinute: number;
  maxEnvelopeBytes: number;
  sabcl: SabclEnvironment;
  routes: SabclRouteTable;
}

export const ROUTER_CONFIG = Symbol('ROUTER_CONFIG');

export function loadRootEnvironment(): void {
  loadEnvironment({
    path: resolve(process.cwd(), '..', '..', '.env'),
    quiet: true,
  });
}

function integer(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

const routeDefinitionSchema = z
  .object({
    routeId: z.string().min(3).max(64),
    service: z.string().min(1).max(64),
    destination: z.string().url(),
    revoked: z.boolean().optional(),
  })
  .strict();

/**
 * Default route table for a local stack.
 *
 * A route names a capability and a destination. Adding one here is the only way
 * to make a destination reachable through the router; there is no wildcard and
 * no request-supplied URL.
 */
function defaultRoutes(): SabclRoute[] {
  const identity =
    process.env.IDENTITY_SERVICE_URL?.trim() || 'http://127.0.0.1:4101';
  const ledger =
    process.env.LEDGER_SERVICE_URL?.trim() || 'http://127.0.0.1:4102';
  const payments =
    process.env.PAYMENTS_SERVICE_URL?.trim() || 'http://127.0.0.1:4104';
  return [
    { routeId: 'identity.step-up', service: 'identity', destination: identity },
    { routeId: 'ledger.accounts', service: 'ledger', destination: ledger },
    { routeId: 'ledger.postings', service: 'ledger', destination: ledger },
    {
      routeId: 'payments.transfer',
      service: 'payments',
      destination: payments,
    },
  ];
}

/**
 * Reads the route table from SABCL_ROUTES when present, else uses the local
 * defaults. Parsing failures are fatal: a router with a half-understood route
 * table would silently stop serving a capability.
 */
function loadRoutes(): SabclRoute[] {
  const raw = process.env.SABCL_ROUTES?.trim();
  if (!raw) return defaultRoutes();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SABCL_ROUTES must be valid JSON.');
  }
  const result = z.array(routeDefinitionSchema).min(1).safeParse(parsed);
  if (!result.success) {
    throw new Error('SABCL_ROUTES must be an array of route definitions.');
  }
  return result.data;
}

export function createRouterConfig(): RouterConfig {
  loadRootEnvironment();

  // Startup validation. In strict mode a missing or invalid key is a hard
  // failure: the router must never come up in a state where it would accept
  // traffic it cannot authenticate.
  const sabcl = loadSabclEnvironment({
    mode: process.env.SABCL_MODE,
    keyId: process.env.SABCL_ROUTER_KEY_ID,
    encryptionPrivateKey: process.env.SABCL_ROUTER_ENCRYPTION_PRIVATE_KEY,
    signingPrivateKey: process.env.SABCL_ROUTER_SIGNING_PRIVATE_KEY,
    peers: process.env.SABCL_PEERS,
    routeSecret: process.env.SABCL_ROUTE_SECRET,
    nodeEnvironment: process.env.NODE_ENV?.trim() || 'development',
  });
  if (!sabcl) {
    throw new Error(
      'The SABCL router cannot start with SABCL_MODE=off. Set strict or compatible.',
    );
  }

  const config: RouterConfig = {
    nodeEnvironment: process.env.NODE_ENV?.trim() || 'development',
    host: process.env.SABCL_ROUTER_HOST?.trim() || '127.0.0.1',
    port: integer('SABCL_ROUTER_PORT', SABCL_ROUTER_DEFAULT_PORT),
    redisUrl:
      process.env.REDIS_URL?.trim() ||
      'redis://:aegis-local-redis-change-me@127.0.0.1:6379/0',
    redisKeyPrefix: process.env.SABCL_REDIS_PREFIX?.trim() || 'aegis:sabcl:',
    forwardTimeoutMs: integer('SABCL_FORWARD_TIMEOUT_MS', 5_000, 100),
    rateLimitPerMinute: integer('SABCL_RATE_LIMIT_PER_MINUTE', 600),
    maxEnvelopeBytes: integer('SABCL_MAX_ENVELOPE_BYTES', 262_144, 1_024),
    sabcl,
    routes: new SabclRouteTable(sabcl.routeSecret, loadRoutes()),
  };

  return config;
}
