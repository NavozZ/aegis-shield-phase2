# Recovery operator authorization

## Who may see recovery evidence

Only a signed-in security operator. Recovery evidence names which databases
exist, when they were last captured, how large the encrypted set is, and whether
a restore has ever been proved to work. That is an accurate map of what is worth
stealing and when the platform is least able to recover, so it is not customer
data and it is not public.

## One session store, not two

The Risk service already owns security-operator sessions: bootstrap, expiry,
revocation, CSRF token issuance and validation, all in Redis behind its own
internal-token boundary. The recovery console reuses it rather than introducing a
second store.

That is a deliberate choice. Two session stores means two places to get expiry,
revocation and CSRF wrong, and two places to fix when one is found lacking. See
[operator authorization model](./operator-authorization-model.md) for the
underlying session design.

## Request path

```text
Browser
  │  cookies: aegis_operator_session (HttpOnly), aegis_operator_csrf (readable)
  │  header:  x-csrf-token on every mutation
  ▼
Gateway  /api/v1/security-ops/resilience/*
  │  1. read the operator session cookie
  │  2. on a mutation, require the double-submit CSRF token to match
  │  3. POST /internal/v1/operators/validate to Risk with the session
  │  4. require role === 'SECURITY_OPERATOR'
  ▼
Resilience :4106  /internal/v1/*
     header: x-aegis-source-token = RESILIENCE_GATEWAY_SOURCE_TOKEN
```

Authorization happens before Resilience is contacted at all. A caller with no
session, an expired session, or a session whose role is not `SECURITY_OPERATOR`
never causes a request to the Resilience service — a unit test asserts exactly
that for each case.

## Credentials, and why they are separate

| Credential                        | Held by          | Purpose                        |
| --------------------------------- | ---------------- | ------------------------------ |
| `RESILIENCE_INTERNAL_TOKEN`       | operator tooling | full internal access           |
| `RESILIENCE_GATEWAY_SOURCE_TOKEN` | Gateway          | browser-driven read and record |
| `RESILIENCE_TOOLING_SOURCE_TOKEN` | DR CLI           | drill progress reporting       |

The Gateway is one caller among several and gets the credential matched to its
role. A leaked gateway token cannot be replayed as operator tooling. All three
are compared in constant time, and every authentication failure returns the same
`401` regardless of whether the header was missing, malformed or wrong.

## Route surface

| Method | Route                                                    | Mutation | Purpose                          |
| ------ | -------------------------------------------------------- | -------- | -------------------------------- |
| GET    | `/api/v1/security-ops/resilience/readiness`              | no       | platform recovery readiness      |
| GET    | `/api/v1/security-ops/resilience/drills`                 | no       | paginated drill history          |
| GET    | `/api/v1/security-ops/resilience/drills/:id`             | no       | one drill                        |
| GET    | `/api/v1/security-ops/resilience/drills/:id/events`      | no       | that drill's append-only history |
| POST   | `/api/v1/security-ops/resilience/drills`                 | yes      | record a **planned** drill       |
| POST   | `/api/v1/security-ops/resilience/drills/:id/acknowledge` | yes      | acknowledge a failed drill       |

Read-mostly by design. There is no route that starts a backup, starts a restore,
names a file, names a database or supplies a key, because none of those belong to
a browser. Recording a planned drill creates a record; running the drill is a
command-line action.

## Acknowledgement integrity

Acknowledging a failed drill is the one action that writes an operator's name
into permanent evidence, so it is constrained tightly:

- Only a drill in state `FAILED` may be acknowledged; anything else is a `409`.
- A drill may be acknowledged exactly once; a second attempt is a `409`.
- The reason is required, trimmed, and between 8 and 500 characters.
- The acknowledging operator is taken from the validated session. A body,
  query-string or header value is never used, and a unit test asserts the
  session's operator id is what reaches the service.
- Acknowledgement completeness is enforced in the database: a CHECK constraint
  requires who, why and when together or none of them.

## Input validation at the boundary

Identifiers must match `^[A-Za-z0-9:_-]{8,128}$`. Pagination accepts only
`cursor`, `limit` (1–50) and `state`, and the schema is strict — an unexpected
query parameter is rejected at the Gateway rather than forwarded, which is what
stops `?databaseUrl=…` style probing from reaching an internal service. Path
identifiers are percent-encoded before they are placed in an upstream URL.

## Failure behaviour

Upstream failures collapse to a small set of safe codes so the console cannot be
used to probe internal topology:

| Upstream                                  | Client sees                       |
| ----------------------------------------- | --------------------------------- |
| 409                                       | `409 RESILIENCE_STATE_CONFLICT`   |
| 404                                       | `404 RESILIENCE_RECORD_NOT_FOUND` |
| 5xx, timeout, refused, contract violation | `503 RESILIENCE_UNAVAILABLE`      |

A connection error, a 500 and a schema mismatch all read the same from outside.
The response body from the upstream service is discarded entirely rather than
trimmed, and a test asserts that a `postgresql://` URL in an upstream 200
response causes a 503 with no trace of the URL.

## Production caveat

Operator bootstrap in this prototype uses a development access token, which is
explicitly disabled in production. Real workforce identity integration —
directory-backed accounts, multi-factor authentication, joiner/mover/leaver
handling and separation of duties between the person who runs a restore and the
person who acknowledges its failure — remains required and is not implemented
here.

## Related documents

- [Operator authorization model](./operator-authorization-model.md)
- [Disaster-recovery threat model](./disaster-recovery-threat-model.md)
- [Operational resilience and DR architecture](../architecture/operational-resilience-and-dr.md)
