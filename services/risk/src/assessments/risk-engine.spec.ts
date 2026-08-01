import { randomUUID } from 'node:crypto';
import {
  evaluateRisk,
  riskBand,
  triggeredRiskRules,
  type RiskFacts,
} from './risk-engine';
const input = {
  evaluationId: randomUUID(),
  operation: 'TRANSFER_CONFIRMATION' as const,
  subjectId: 'opaque_subject_01',
  amountMinor: '1',
  currency: 'LKR',
  stepUpVerified: false,
  occurredAt: new Date().toISOString(),
  correlationId: randomUUID(),
};
const empty: RiskFacts = {
  authFailures: 0,
  requestVelocity: 0,
  transferVelocity: 0,
  cumulativeOutgoingMinor: 0n,
  newRecipient: false,
  insufficientFunds: 0,
  idempotencyConflicts: 0,
  linkedSubjectsForDevice: 0,
  rapidRegionChange: false,
  integrityAnomaly: false,
  internalAuthFailures: 0,
  csrfMalformedFailures: 0,
  blockedScope: false,
  activeIncident: false,
  activeControl: false,
};
const cases: Array<[keyof RiskFacts, unknown, string]> = [
  ['authFailures', 5, 'AUTH_FAILURE_BURST'],
  ['requestVelocity', 60, 'REQUEST_VELOCITY'],
  ['transferVelocity', 5, 'TRANSFER_VELOCITY'],
  ['cumulativeOutgoingMinor', 25_000_000n, 'CUMULATIVE_OUTGOING'],
  ['newRecipient', true, 'NEW_RECIPIENT_HIGH_VALUE'],
  ['insufficientFunds', 3, 'INSUFFICIENT_FUNDS_BURST'],
  ['idempotencyConflicts', 2, 'REPLAY_PATTERN'],
  ['linkedSubjectsForDevice', 3, 'SHARED_DEVICE_CLUSTER'],
  ['rapidRegionChange', true, 'RAPID_REGION_CHANGE'],
  ['integrityAnomaly', true, 'INTEGRITY_ANOMALY'],
  ['internalAuthFailures', 1, 'INTERNAL_AUTH_FAILURE'],
  ['csrfMalformedFailures', 5, 'SENSITIVE_REQUEST_FAILURES'],
  ['blockedScope', true, 'KNOWN_BLOCKED_SCOPE'],
  ['activeIncident', true, 'EXISTING_RISK_STATE'],
];
describe('deterministic risk rules', () => {
  it.each(cases)('triggers %s deterministically', (key, value, rule) => {
    const facts = { ...empty, [key]: value };
    const candidate =
      key === 'newRecipient' ? { ...input, amountMinor: '10000000' } : input;
    expect(triggeredRiskRules(candidate, facts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: rule })]),
    );
  });
  it('triggers the high value rule from integer minor units', () =>
    expect(
      triggeredRiskRules({ ...input, amountMinor: '10000000' }, empty).map(
        (rule) => rule.code,
      ),
    ).toContain('HIGH_VALUE'));
  it.each([
    [0, 'LOW'],
    [24, 'LOW'],
    [25, 'MEDIUM'],
    [49, 'MEDIUM'],
    [50, 'HIGH'],
    [74, 'HIGH'],
    [75, 'CRITICAL'],
    [100, 'CRITICAL'],
  ])('maps %d to %s', (score, band) => expect(riskBand(score)).toBe(band));
  it('prioritizes a known block over step-up', () =>
    expect(evaluateRisk(input, { ...empty, blockedScope: true }).decision).toBe(
      'BLOCK',
    ));
  it('allows verified moderate operations with monitoring', () =>
    expect(
      evaluateRisk(
        { ...input, stepUpVerified: true },
        { ...empty, authFailures: 5 },
      ).decision,
    ).toBe('ALLOW_WITH_MONITORING'));
});
