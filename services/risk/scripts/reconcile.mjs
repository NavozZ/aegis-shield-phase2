import { randomUUID } from 'node:crypto';
const url = new URL(
  '/internal/v1/reconciliation',
  process.env.RISK_SERVICE_URL || 'http://127.0.0.1:4105',
);
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'x-aegis-internal-token': process.env.RISK_INTERNAL_TOKEN || '',
    'x-correlation-id': randomUUID(),
  },
});
const body = await response.json();
console.log(JSON.stringify(body));
if (!response.ok || body.status !== 'PASS') process.exitCode = 1;
