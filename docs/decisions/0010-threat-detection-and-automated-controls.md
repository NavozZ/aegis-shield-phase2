# ADR 0010: Deterministic threat detection and scoped controls

## Decision

Create an independent Risk service on reserved port 4105 using the existing least-privilege audit database and authenticated Redis. Use strict versioned events, deterministic integer-weight rules, persisted explanations, expiring scoped controls and append-only incidents/audit history. Enforce transfers at Gateway and independently in Payments; invoke Identity through an explicit revocation contract.

## Consequences

Sensitive transfers fail closed when Risk is unavailable, while telemetry is generally fail-open and visible through source health. The approach is explainable and testable but threshold rules require governance and cannot replace a trained fraud model or investigator. Development operator bootstrap is explicitly disabled in production, where workforce identity integration remains required.
