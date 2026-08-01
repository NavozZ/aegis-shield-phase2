import assert from 'node:assert/strict';
import test from 'node:test';
import { securityEventV1Schema } from './v1.js';

const valid = {
  schemaVersion: '1.0',
  eventId: '719953e8-7105-4aa7-93fd-00bb5d98fb28',
  source: 'GATEWAY',
  sourceEventId: 'gateway:event:1',
  eventType: 'CSRF_FAILURE',
  severity: 'MEDIUM',
  occurredAt: '2026-08-01T10:00:00.000Z',
  subjectId: 'subject_opaque_123',
  correlationId: '0d04412d-b2df-49a7-b755-cc03ba6c568e',
  attributes: { route: '/api/v1/transfers/confirm', httpStatus: 403 },
};

test('accepts allowlisted safe security event attributes', () =>
  assert.equal(securityEventV1Schema.parse(valid).source, 'GATEWAY'));
test('rejects secrets and unallowlisted attributes', () =>
  assert.equal(
    securityEventV1Schema.safeParse({
      ...valid,
      attributes: { token: 'secret' },
    }).success,
    false,
  ));
test('rejects oversized contextual values', () =>
  assert.equal(
    securityEventV1Schema.safeParse({
      ...valid,
      attributes: { route: 'x'.repeat(257) },
    }).success,
    false,
  ));
