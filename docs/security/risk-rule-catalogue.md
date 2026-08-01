# Risk rule catalogue and decisions

Rule set `risk-rules-2026-08-v1` adds capped integer weights for authentication failure burst, request velocity, transfer velocity, cumulative outgoing value, high value, new-recipient high value, insufficient-funds burst, replay/idempotency conflict, shared device cluster, reliable rapid-region change, integrity anomaly, internal authentication failure, repeated CSRF/malformed sensitive requests, known blocked scope and existing incident/control.

Scores are capped at 100: LOW 0–24, MEDIUM 25–49, HIGH 50–74, CRITICAL 75–100. LOW allows; a nonzero low score allows with monitoring; MEDIUM requires fresh step-up unless already verified; HIGH holds for review; CRITICAL quarantines. A known active block takes priority over aggregate score. All triggered rule and reason codes are stored.

Money stays decimal-string/BigInt. High-value and cumulative thresholds use validated environment configuration. IP geolocation is not implemented; the rapid-region rule remains false unless a future explicit provider supplies reliable coarse region fixtures.
