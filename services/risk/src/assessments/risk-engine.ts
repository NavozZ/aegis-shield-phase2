import type {
  ControlType,
  RiskDecision,
  RiskEvaluationRequest,
} from '@aegis/contracts';

export const RULE_SET_VERSION = 'risk-rules-2026-08-v1';
export interface RiskThresholds {
  authFailures: number;
  requestVelocity: number;
  transferVelocity: number;
  cumulativeOutgoingMinor: bigint;
  highValueMinor: bigint;
  insufficientFunds: number;
  idempotencyConflicts: number;
  linkedSubjectsPerDevice: number;
  csrfMalformed: number;
}
export const DEFAULT_THRESHOLDS: RiskThresholds = {
  authFailures: 5,
  requestVelocity: 60,
  transferVelocity: 5,
  cumulativeOutgoingMinor: 25_000_000n,
  highValueMinor: 10_000_000n,
  insufficientFunds: 3,
  idempotencyConflicts: 2,
  linkedSubjectsPerDevice: 3,
  csrfMalformed: 5,
};
export interface RiskFacts {
  authFailures: number;
  requestVelocity: number;
  transferVelocity: number;
  cumulativeOutgoingMinor: bigint;
  newRecipient: boolean;
  insufficientFunds: number;
  idempotencyConflicts: number;
  linkedSubjectsForDevice: number;
  rapidRegionChange: boolean;
  integrityAnomaly: boolean;
  internalAuthFailures: number;
  csrfMalformedFailures: number;
  blockedScope: boolean;
  activeIncident: boolean;
  activeControl: boolean;
}
export interface TriggeredRule {
  code: string;
  reasonCode: string;
  weight: number;
}
export interface EngineResult {
  score: number;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  decision: RiskDecision;
  triggeredRules: string[];
  reasonCodes: string[];
  controlRecommendation: ControlType | null;
  publicExplanation: string;
}

export function triggeredRiskRules(
  input: RiskEvaluationRequest,
  facts: RiskFacts,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
): TriggeredRule[] {
  const amount = BigInt(input.amountMinor || '0');
  const rules: Array<[boolean, TriggeredRule]> = [
    [
      facts.authFailures >= thresholds.authFailures,
      {
        code: 'AUTH_FAILURE_BURST',
        reasonCode: 'REPEATED_AUTH_FAILURES',
        weight: 25,
      },
    ],
    [
      facts.requestVelocity >= thresholds.requestVelocity,
      {
        code: 'REQUEST_VELOCITY',
        reasonCode: 'SUSPICIOUS_REQUEST_VELOCITY',
        weight: 20,
      },
    ],
    [
      facts.transferVelocity >= thresholds.transferVelocity,
      {
        code: 'TRANSFER_VELOCITY',
        reasonCode: 'HIGH_TRANSFER_VELOCITY',
        weight: 25,
      },
    ],
    [
      facts.cumulativeOutgoingMinor >= thresholds.cumulativeOutgoingMinor,
      {
        code: 'CUMULATIVE_OUTGOING',
        reasonCode: 'HIGH_CUMULATIVE_VALUE',
        weight: 25,
      },
    ],
    [
      amount >= thresholds.highValueMinor,
      { code: 'HIGH_VALUE', reasonCode: 'HIGH_VALUE_TRANSFER', weight: 20 },
    ],
    [
      amount >= thresholds.highValueMinor && facts.newRecipient,
      {
        code: 'NEW_RECIPIENT_HIGH_VALUE',
        reasonCode: 'NEW_RECIPIENT_HIGH_VALUE',
        weight: 30,
      },
    ],
    [
      facts.insufficientFunds >= thresholds.insufficientFunds,
      {
        code: 'INSUFFICIENT_FUNDS_BURST',
        reasonCode: 'REPEATED_INSUFFICIENT_FUNDS',
        weight: 15,
      },
    ],
    [
      facts.idempotencyConflicts >= thresholds.idempotencyConflicts,
      {
        code: 'REPLAY_PATTERN',
        reasonCode: 'REPLAY_LIKE_BEHAVIOUR',
        weight: 35,
      },
    ],
    [
      facts.linkedSubjectsForDevice >= thresholds.linkedSubjectsPerDevice,
      {
        code: 'SHARED_DEVICE_CLUSTER',
        reasonCode: 'SUSPICIOUS_DEVICE_CLUSTER',
        weight: 25,
      },
    ],
    [
      facts.rapidRegionChange,
      {
        code: 'RAPID_REGION_CHANGE',
        reasonCode: 'RAPID_REGION_CHANGE',
        weight: 15,
      },
    ],
    [
      facts.integrityAnomaly,
      {
        code: 'INTEGRITY_ANOMALY',
        reasonCode: 'INTEGRITY_ANOMALY',
        weight: 60,
      },
    ],
    [
      facts.internalAuthFailures > 0,
      {
        code: 'INTERNAL_AUTH_FAILURE',
        reasonCode: 'INTERNAL_AUTHENTICATION_FAILURE',
        weight: 50,
      },
    ],
    [
      facts.csrfMalformedFailures >= thresholds.csrfMalformed,
      {
        code: 'SENSITIVE_REQUEST_FAILURES',
        reasonCode: 'REPEATED_INVALID_REQUESTS',
        weight: 20,
      },
    ],
    [
      facts.blockedScope,
      { code: 'KNOWN_BLOCKED_SCOPE', reasonCode: 'ACTIVE_BLOCK', weight: 100 },
    ],
    [
      facts.activeIncident || facts.activeControl,
      {
        code: 'EXISTING_RISK_STATE',
        reasonCode: 'ACTIVE_INCIDENT_OR_CONTROL',
        weight: 50,
      },
    ],
  ];
  return rules.filter(([matched]) => matched).map(([, rule]) => rule);
}

export function riskBand(score: number): EngineResult['band'] {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}
export function evaluateRisk(
  input: RiskEvaluationRequest,
  facts: RiskFacts,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
): EngineResult {
  const rules = triggeredRiskRules(input, facts, thresholds);
  const score = Math.min(
    100,
    rules.reduce((sum, rule) => sum + rule.weight, 0),
  );
  const band = riskBand(score);
  let decision: RiskDecision = 'ALLOW';
  let controlRecommendation: ControlType | null = null;
  if (facts.blockedScope) {
    decision = 'BLOCK';
    controlRecommendation = 'TEMPORARY_BLOCK';
  } else if (band === 'CRITICAL') {
    decision = 'QUARANTINE';
    controlRecommendation = 'QUARANTINE';
  } else if (band === 'HIGH') {
    decision = 'HOLD_FOR_REVIEW';
    controlRecommendation = 'TRANSFER_HOLD';
  } else if (band === 'MEDIUM' && !input.stepUpVerified) {
    decision = 'REQUIRE_STEP_UP';
    controlRecommendation = 'REQUIRE_STEP_UP';
  } else if (band === 'MEDIUM' || rules.length > 0)
    decision = 'ALLOW_WITH_MONITORING';
  return {
    score,
    band,
    decision,
    triggeredRules: rules.map((rule) => rule.code),
    reasonCodes: rules.map((rule) => rule.reasonCode),
    controlRecommendation,
    publicExplanation:
      decision === 'ALLOW'
        ? 'No additional verification is required.'
        : decision === 'ALLOW_WITH_MONITORING'
          ? 'The operation may continue with security monitoring.'
          : decision === 'REQUIRE_STEP_UP'
            ? 'Additional identity verification is required.'
            : 'The operation cannot continue while a security review is active.',
  };
}
