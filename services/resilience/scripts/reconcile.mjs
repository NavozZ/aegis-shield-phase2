#!/usr/bin/env node
// Operator entry point for Resilience reconciliation.
//
// Calls the running service rather than reaching into its schema, so the check
// runs behind the same internal-token boundary as every other caller.
import { randomUUID } from 'node:crypto';

const url = new URL(
  '/internal/v1/reconciliation',
  process.env.RESILIENCE_SERVICE_URL || 'http://127.0.0.1:4106',
);
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'x-aegis-internal-token': process.env.RESILIENCE_INTERNAL_TOKEN || '',
    'x-correlation-id': randomUUID(),
    connection: 'close',
  },
});
const body = await response.json().catch(() => undefined);
console.log(JSON.stringify(body ?? { status: 'FAIL', reason: 'NO_RESPONSE' }));
if (!response.ok || body?.status !== 'PASS') process.exitCode = 1;
