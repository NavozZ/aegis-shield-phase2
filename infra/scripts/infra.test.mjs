import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  CliUsageError,
  buildComposeArguments,
  createDockerInvocation,
  isExpectedVolumeOwnership,
  parseCliArguments,
  resolveComposeFile,
  resolveRepositoryRoot,
  safeErrorMessage,
} from './infra.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

test('unsupported command is rejected without reflecting its value', () => {
  assert.throws(
    () => parseCliArguments(['credential-shaped-input']),
    (error) =>
      error instanceof CliUsageError &&
      error.message ===
        'Unsupported infrastructure command. Use up, down, status, logs, check, validate, or reset.' &&
      !error.message.includes('credential-shaped-input'),
  );
});

test('unsupported log service is rejected', () => {
  assert.throws(
    () => parseCliArguments(['logs', 'database']),
    /Unsupported log service/u,
  );
});

test('reset without explicit confirmation is rejected', () => {
  assert.throws(
    () => parseCliArguments(['reset']),
    /pnpm infra:reset -- --yes/u,
  );
});

test('repository root resolution is independent of the current directory', () => {
  const syntheticModuleUrl = pathToFileURL(
    resolve(repositoryRoot, 'infra', 'scripts', 'synthetic.mjs'),
  ).href;
  assert.equal(resolveRepositoryRoot(syntheticModuleUrl), repositoryRoot);
});

test('Compose file path resolves from the repository root', () => {
  assert.equal(
    resolveComposeFile(repositoryRoot),
    resolve(repositoryRoot, 'docker-compose.yml'),
  );
});

test('Docker Compose commands use argument arrays with shell disabled', () => {
  const composeArguments = buildComposeArguments(repositoryRoot, [
    'logs',
    '--tail=200',
    'redis',
  ]);
  const invocation = createDockerInvocation(repositoryRoot, composeArguments);

  assert.equal(invocation.command, 'docker');
  assert.equal(invocation.options.shell, false);
  assert.ok(Array.isArray(invocation.arguments));
  assert.deepEqual(invocation.arguments.slice(-3), [
    'logs',
    '--tail=200',
    'redis',
  ]);
});

test('ordinary unexpected errors do not expose secret-bearing messages', () => {
  const secret = 'should-never-be-rendered';
  const renderedMessage = safeErrorMessage(
    new Error(`command failed with password ${secret}`),
  );

  assert.equal(renderedMessage, 'Infrastructure command failed unexpectedly.');
  assert.ok(!renderedMessage.includes(secret));
});

test('reset volume ownership requires the exact Compose project and logical name', () => {
  assert.equal(
    isExpectedVolumeOwnership(
      'aegis-postgres-data',
      'aegis-shield|aegis-postgres-data',
    ),
    true,
  );
  assert.equal(
    isExpectedVolumeOwnership(
      'aegis-postgres-data',
      'another-project|aegis-postgres-data',
    ),
    false,
  );
  assert.equal(
    isExpectedVolumeOwnership(
      'aegis-postgres-data',
      'aegis-shield|unrelated-volume',
    ),
    false,
  );
});
