# ADR 0005: Authentication user experience

- Status: Accepted
- Date: 2026-07-31
- Decision owners: AEGIS Shield Phase 2 team

## Context

Prompt 03 established phone onboarding, OTP and PIN verification, WebAuthn boundaries, opaque sessions, and CSRF enforcement behind the API Gateway. Prompt 04 needs a usable customer journey without moving authentication policy or secrets into the Next.js application. The experience must support English, Sinhala, and Tamil, keyboard and assistive-technology users, small screens, unavailable dependencies, and browsers without passkey support.

## Decision

Use a single, accessible multi-step onboarding page for phone consent, OTP verification, PIN creation, optional passkey enrollment, and completion. The steps preserve only active flow values in React memory. Reloading clears the phone, challenge, OTP, enrollment token, and PIN and asks the customer to restart.

Make passkeys the primary sign-in action. Use the browser WebAuthn ceremony against the Gateway-provided options. Keep phone, PIN, and OTP as a clearly available fallback for unsupported devices and recovery-oriented access. AEGIS receives public-key credential material, never biometric or device-unlock data.

Persist no authentication data in `localStorage` or `sessionStorage`. Only the interface-language preference may be stored. The opaque session remains in an HttpOnly cookie, while the readable CSRF cookie is used only for the Gateway's double-submit header.

Use Next.js server components to ask the Gateway for safe session state before protected routes render. Public onboarding and sign-in redirect authenticated customers; missing or expired sessions redirect to sign-in; dependency failure renders a bounded service-unavailable view. Client-side logout revokes the session, replaces browser history, and refreshes server state.

Provide complete, type-checked English, Sinhala, and Tamil dictionaries. All controls, errors, security explanations, loading labels, and navigation labels use the active dictionary.

Treat WCAG-oriented accessibility as a release constraint: semantic landmarks, one labeled OTP field, programmatically associated errors, focus movement, error summaries, keyboard operation, visible focus, reduced motion, adequate touch targets, responsive layouts, and no serious or critical axe violations.

Use direct browser-to-Gateway authentication calls. Next.js serves UI and performs server-side session reads, but it is not an authentication proxy. Identity remains private and accepts only authenticated internal Gateway calls.

## Consequences

- Customers get one coherent onboarding route without placing sensitive state in URLs or storage.
- Reload is intentionally destructive to an unfinished authentication flow.
- Passkeys are easy to prefer without removing a broadly usable fallback.
- Direct Gateway calls require exact credentialed CORS and CSRF configuration.
- Server-aware protected pages avoid optimistic client-only authorization.
- Dictionary completeness and accessibility checks become ongoing maintenance requirements.

## Residual risks

- Same-origin script compromise can observe active in-memory form values and invoke credentialed requests.
- A compromised device or delivery channel can expose fallback factors.
- WebAuthn behavior varies across authenticators and assistive technologies beyond the tested Chromium virtual authenticator.
- Service outages prevent new authentication and safe session refresh.
- Language quality requires continued review by fluent speakers.
- Production OTP delivery, account recovery, authenticator revocation, and security operations remain future work.
