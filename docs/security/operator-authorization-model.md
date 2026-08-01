# Security operator authorization

`SECURITY_OPERATOR` is separate from customer sessions. The Gateway stores an opaque operator session in an HttpOnly SameSite cookie and a distinct CSRF value in a readable cookie. Risk validates session TTL and role on every operator call; Gateway and Risk both rate-limit or authenticate their boundaries. Mutations require CSRF and write an operator audit plus incident/control history.

Local and CI environments may set a high-entropy `RISK_OPERATOR_BOOTSTRAP_TOKEN`. Risk refuses this setting in production. It is a development bootstrap mechanism, not a production shared password. Production must connect the same short-lived session contract to an approved workforce identity provider with MFA and recent reauthentication.

The initial operator console deliberately uses English-only security terminology. This exception is limited to trained internal operators and is documented here; customer EN/SI/TA behavior remains unchanged.
