#!/usr/bin/env node
/**
 * Generates a fresh SABCL service identity.
 *
 *   pnpm --filter @aegis/sabcl keys:generate -- --service gateway --version 1
 *
 * Prints the private material for the service's own environment and the public
 * material every peer needs in its SABCL_PEERS list. Nothing is written to
 * disk: piping this into a file is a decision the operator makes explicitly.
 *
 * Rotation is generating a new identity with the next --version, publishing the
 * public half to every peer first, then switching the owning service over. See
 * docs/security/sabcl-key-management.md.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    service: { type: 'string' },
    version: { type: 'string', default: '1' },
    'route-secret': { type: 'boolean', default: false },
  },
});

const rawPublic = (key) => {
  const der = key.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64url');
};
const rawPrivate = (key) => {
  const der = key.export({ format: 'der', type: 'pkcs8' });
  return der.subarray(der.length - 32).toString('base64url');
};

if (values['route-secret']) {
  process.stdout.write(
    `SABCL_ROUTE_SECRET=${randomBytes(32).toString('base64url')}\n`,
  );
  process.exit(0);
}

if (!values.service || !/^[a-z][a-z0-9-]*$/u.test(values.service)) {
  process.stderr.write(
    'Usage: generate-keys.mjs --service <name> [--version <n>]\n' +
      '       generate-keys.mjs --route-secret\n',
  );
  process.exit(1);
}
if (!/^[0-9]+$/u.test(values.version)) {
  process.stderr.write('--version must be a non-negative integer\n');
  process.exit(1);
}

const keyId = `${values.service}.v${values.version}`;
const encryption = generateKeyPairSync('x25519');
const signing = generateKeyPairSync('ed25519');

const upper = values.service.toUpperCase().replaceAll('-', '_');
process.stdout.write(
  [
    `# Private material for ${keyId} — keep in the service's own secret store.`,
    `# Never commit these values and never log them.`,
    `SABCL_${upper}_KEY_ID=${keyId}`,
    `SABCL_${upper}_ENCRYPTION_PRIVATE_KEY=${rawPrivate(encryption.privateKey)}`,
    `SABCL_${upper}_SIGNING_PRIVATE_KEY=${rawPrivate(signing.privateKey)}`,
    '',
    `# Public entry for every peer's SABCL_PEERS array.`,
    JSON.stringify({
      keyId,
      encryptionPublicKey: rawPublic(encryption.publicKey),
      signingPublicKey: rawPublic(signing.publicKey),
    }),
    '',
  ].join('\n'),
);
