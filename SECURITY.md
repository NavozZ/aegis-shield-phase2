# Security Policy

## Supported status

AEGIS Shield Phase 2 is an educational prototype under active development. No version is supported for production use, and the project provides no production security or availability guarantee.

Do not use this repository with real financial data, real money, personal customer data, real banking credentials, production secrets, or production infrastructure. Demonstrations must use synthetic identities and fake balances only.

## Responsible disclosure

Please do not disclose suspected vulnerabilities in public issues, discussions, pull requests, screenshots, or chat channels. Report them privately through GitHub's **Security** tab by selecting **Report a vulnerability** for this repository. Include a clear description, affected component and revision, reproduction steps, impact, and any safe supporting evidence.

If private vulnerability reporting is unavailable, contact the repository owner privately and provide only enough non-sensitive information to establish a secure reporting channel. Do not exploit a vulnerability beyond the minimum necessary to demonstrate it, access other users' data, disrupt services, or retain data obtained during testing.

## Secrets handling

- Never commit credentials, access tokens, private keys, certificates, signing material, recovery codes, personal data, or secret-bearing logs.
- Use safe fake values in `.env.example` and keep real local configuration in ignored `.env` files.
- Remove secrets from logs, screenshots, test fixtures, issue reports, and pull-request descriptions.
- Use least-privilege credentials and approved secret storage when implementation begins.
- If exposure is suspected, revoke or rotate the credential first, notify the repository owner privately, and then remove it from the repository and history using an agreed incident process.

Security reports will be acknowledged and triaged as project capacity permits. Public disclosure should be coordinated with the maintainers after a remediation or documented risk decision.
