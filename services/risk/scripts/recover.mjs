import { randomUUID } from 'node:crypto';
for (const path of ['/internal/v1/controls/check', '/internal/v1/retention']) {
  const body = path.includes('check')
    ? {
        operation: 'RECOVERY',
        scopes: [{ type: 'OPERATION', id: 'operation:recovery' }],
        correlationId: randomUUID(),
      }
    : {};
  const response = await fetch(
    new URL(path, process.env.RISK_SERVICE_URL || 'http://127.0.0.1:4105'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aegis-internal-token': process.env.RISK_INTERNAL_TOKEN || '',
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) process.exitCode = 1;
}
