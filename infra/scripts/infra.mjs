import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COMPOSE_PROJECT_NAME = 'aegis-shield';
const SUPPORTED_COMMANDS = new Set([
  'up',
  'down',
  'status',
  'logs',
  'check',
  'validate',
  'reset',
]);
const SUPPORTED_LOG_SERVICES = new Set(['postgres', 'redis']);
const RESET_VOLUMES = ['aegis-postgres-data', 'aegis-redis-data'];
const REQUIRED_FILES = [
  'docker-compose.yml',
  '.env.example',
  'infra/docker/postgres/init/01-create-service-databases.sh',
];
const REQUIRED_ENVIRONMENT_DECLARATIONS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_ADMIN_DATABASE',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'IDENTITY_DB_NAME',
  'IDENTITY_DB_USER',
  'IDENTITY_DB_PASSWORD',
  'IDENTITY_DATABASE_URL',
  'LEDGER_DB_NAME',
  'LEDGER_DB_USER',
  'LEDGER_DB_PASSWORD',
  'LEDGER_DATABASE_URL',
  'PAYMENTS_DB_NAME',
  'PAYMENTS_DB_USER',
  'PAYMENTS_DB_PASSWORD',
  'PAYMENTS_DATABASE_URL',
  'AUDIT_DB_NAME',
  'AUDIT_DB_USER',
  'AUDIT_DB_PASSWORD',
  'AUDIT_DATABASE_URL',
  'RESILIENCE_DB_NAME',
  'RESILIENCE_DB_USER',
  'RESILIENCE_DB_PASSWORD',
  'RESILIENCE_DATABASE_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_URL',
  'LEDGER_SERVICE_PORT',
  'LEDGER_SERVICE_URL',
  'LEDGER_INTERNAL_TOKEN',
  'LEDGER_DEFAULT_CURRENCY',
];

const POSTGRES_READY_COMMAND =
  'pg_isready --quiet --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"';
const REDIS_PING_COMMAND =
  'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning ping';
const POSTGRES_METADATA_COMMAND = `psql --quiet --tuples-only --no-align --field-separator='|' \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=identity_db="$IDENTITY_DB_NAME" --set=identity_role="$IDENTITY_DB_USER" \
  --set=ledger_db="$LEDGER_DB_NAME" --set=ledger_role="$LEDGER_DB_USER" \
  --set=payments_db="$PAYMENTS_DB_NAME" --set=payments_role="$PAYMENTS_DB_USER" \
  --set=audit_db="$AUDIT_DB_NAME" --set=audit_role="$AUDIT_DB_USER" \
  --set=resilience_db="$RESILIENCE_DB_NAME" --set=resilience_role="$RESILIENCE_DB_USER" <<'SQL'
WITH expected(database_name, role_name) AS (VALUES
    (:'identity_db', :'identity_role'),
    (:'ledger_db', :'ledger_role'),
    (:'payments_db', :'payments_role'),
    (:'audit_db', :'audit_role'),
    (:'resilience_db', :'resilience_role')
  )
  SELECT
    (SELECT count(*) = 5 FROM expected e JOIN pg_database d ON d.datname = e.database_name),
    (SELECT count(*) = 5 FROM expected e JOIN pg_roles r ON r.rolname = e.role_name),
    (SELECT count(*) = 5 FROM expected e JOIN pg_database d ON d.datname = e.database_name JOIN pg_roles r ON r.oid = d.datdba AND r.rolname = e.role_name);
SQL`;

class InfraError extends Error {
  constructor(message, exitCode = 1, reported = false) {
    super(message);
    this.name = 'InfraError';
    this.exitCode = exitCode;
    this.reported = reported;
  }
}

export class CliUsageError extends InfraError {
  constructor(message) {
    super(message, 2);
    this.name = 'CliUsageError';
  }
}

export class DockerCommandError extends InfraError {
  constructor(exitCode = 1) {
    super(
      'Docker infrastructure command failed. Review Docker Desktop and container logs.',
      exitCode,
    );
    this.name = 'DockerCommandError';
  }
}

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

export function resolveComposeFile(repositoryRoot) {
  return resolve(repositoryRoot, 'docker-compose.yml');
}

export function buildComposeArguments(repositoryRoot, commandArguments) {
  return [
    'compose',
    '--project-name',
    COMPOSE_PROJECT_NAME,
    '--project-directory',
    repositoryRoot,
    '--file',
    resolveComposeFile(repositoryRoot),
    ...commandArguments,
  ];
}

export function createDockerInvocation(repositoryRoot, dockerArguments) {
  return {
    command: 'docker',
    arguments: dockerArguments,
    options: {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
    },
  };
}

export function parseCliArguments(argumentsList) {
  const [command, ...commandArguments] = argumentsList;

  if (!command || !SUPPORTED_COMMANDS.has(command)) {
    throw new CliUsageError(
      'Unsupported infrastructure command. Use up, down, status, logs, check, validate, or reset.',
    );
  }

  if (command === 'logs') {
    if (commandArguments.length > 1) {
      throw new CliUsageError(
        'Logs accepts at most one service: postgres or redis.',
      );
    }

    const [service] = commandArguments;
    if (service && !SUPPORTED_LOG_SERVICES.has(service)) {
      throw new CliUsageError(
        'Unsupported log service. Use postgres or redis.',
      );
    }

    return { command, service };
  }

  if (command === 'reset') {
    if (commandArguments.length !== 1 || commandArguments[0] !== '--yes') {
      throw new CliUsageError(
        'Reset removes local PostgreSQL and Redis data. Confirm with: pnpm infra:reset -- --yes',
      );
    }

    return { command, confirmed: true };
  }

  if (commandArguments.length > 0) {
    throw new CliUsageError(
      'This infrastructure command does not accept additional arguments.',
    );
  }

  return { command };
}

export function safeErrorMessage(error) {
  if (error instanceof InfraError) {
    return error.message;
  }

  return 'Infrastructure command failed unexpectedly.';
}

export function validateRequiredFiles(repositoryRoot) {
  const missingFiles = REQUIRED_FILES.filter(
    (relativePath) => !existsSync(resolve(repositoryRoot, relativePath)),
  );

  if (missingFiles.length > 0) {
    throw new InfraError(
      `Missing required infrastructure files: ${missingFiles.join(', ')}`,
    );
  }

  const environmentTemplate = readFileSync(
    resolve(repositoryRoot, '.env.example'),
    'utf8',
  );
  const declaredNames = new Set(
    environmentTemplate
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/u)?.[1])
      .filter(Boolean),
  );
  const missingDeclarations = REQUIRED_ENVIRONMENT_DECLARATIONS.filter(
    (name) => !declaredNames.has(name),
  );

  if (missingDeclarations.length > 0) {
    throw new InfraError(
      `Missing required environment declarations: ${missingDeclarations.join(', ')}`,
    );
  }

  return true;
}

export function isExpectedVolumeOwnership(volumeName, ownership) {
  return ownership === `${COMPOSE_PROJECT_NAME}|${volumeName}`;
}

function runDocker(repositoryRoot, dockerArguments, { capture = false } = {}) {
  const invocation = createDockerInvocation(repositoryRoot, dockerArguments);
  const result = spawnSync(invocation.command, invocation.arguments, {
    ...invocation.options,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error?.code === 'ENOENT') {
    throw new InfraError(
      'Docker is unavailable. Install Docker Desktop, start it, and ensure docker is on PATH.',
    );
  }

  if (result.error) {
    throw new DockerCommandError();
  }

  if (result.status !== 0) {
    throw new DockerCommandError(result.status ?? 1);
  }

  return capture ? (result.stdout ?? '').trim() : '';
}

function runCompose(repositoryRoot, commandArguments, options) {
  return runDocker(
    repositoryRoot,
    buildComposeArguments(repositoryRoot, commandArguments),
    options,
  );
}

function assertResetVolumesAreOwned(repositoryRoot) {
  const existingVolumes = new Set(
    runDocker(repositoryRoot, ['volume', 'ls', '--quiet'], { capture: true })
      .split(/\r?\n/u)
      .filter(Boolean),
  );

  for (const volumeName of RESET_VOLUMES) {
    if (!existingVolumes.has(volumeName)) {
      continue;
    }

    const ownership = runDocker(
      repositoryRoot,
      [
        'volume',
        'inspect',
        '--format={{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}',
        volumeName,
      ],
      { capture: true },
    );

    if (!isExpectedVolumeOwnership(volumeName, ownership)) {
      throw new InfraError(
        'Reset refused because a target volume is not owned by the AEGIS Compose project.',
      );
    }
  }
}

function containerIsHealthy(repositoryRoot, service) {
  const containerId = runCompose(repositoryRoot, ['ps', '--quiet', service], {
    capture: true,
  });
  if (!containerId) {
    return false;
  }

  const health = runDocker(
    repositoryRoot,
    [
      'inspect',
      '--format={{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}',
      containerId,
    ],
    { capture: true },
  );
  return health === 'healthy';
}

function attemptCheck(name, check) {
  try {
    return { name, passed: Boolean(check()) };
  } catch {
    return { name, passed: false };
  }
}

export function runInfrastructureCheck(repositoryRoot, log = console.log) {
  const results = [];

  results.push(
    attemptCheck('PostgreSQL reports ready', () => {
      runCompose(
        repositoryRoot,
        ['exec', '-T', 'postgres', 'sh', '-c', POSTGRES_READY_COMMAND],
        { capture: true },
      );
      return true;
    }),
  );
  results.push(
    attemptCheck('Redis authenticated PING returns PONG', () => {
      const output = runCompose(
        repositoryRoot,
        ['exec', '-T', 'redis', 'sh', '-c', REDIS_PING_COMMAND],
        { capture: true },
      );
      return output === 'PONG';
    }),
  );

  let metadata = [];
  try {
    metadata = runCompose(
      repositoryRoot,
      ['exec', '-T', 'postgres', 'sh', '-c', POSTGRES_METADATA_COMMAND],
      { capture: true },
    ).split('|');
  } catch {
    metadata = [];
  }

  results.push({
    name: 'All service databases exist',
    passed: metadata[0] === 't',
  });
  results.push({
    name: 'All service roles exist',
    passed: metadata[1] === 't',
  });
  results.push({
    name: 'Database ownership matches service roles',
    passed: metadata[2] === 't',
  });
  results.push(
    attemptCheck('PostgreSQL container is healthy', () =>
      containerIsHealthy(repositoryRoot, 'postgres'),
    ),
  );
  results.push(
    attemptCheck('Redis container is healthy', () =>
      containerIsHealthy(repositoryRoot, 'redis'),
    ),
  );

  for (const result of results) {
    log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  }

  const passedCount = results.filter((result) => result.passed).length;
  const allPassed = passedCount === results.length;
  log(
    `${allPassed ? 'PASS' : 'FAIL'} infrastructure checks (${passedCount}/${results.length})`,
  );
  return allPassed;
}

function runUp(repositoryRoot) {
  runCompose(repositoryRoot, ['up', '-d', '--wait', '--remove-orphans']);
  if (!runInfrastructureCheck(repositoryRoot)) {
    throw new InfraError('Infrastructure health checks failed.', 1, true);
  }
}

function runValidate(repositoryRoot) {
  runCompose(repositoryRoot, ['config', '--quiet'], { capture: true });
  validateRequiredFiles(repositoryRoot);
  console.log(
    'PASS Docker Compose configuration and required declarations are valid.',
  );
}

export function executeCommand(parsedArguments, repositoryRoot) {
  switch (parsedArguments.command) {
    case 'up':
      runUp(repositoryRoot);
      break;
    case 'down':
      runCompose(repositoryRoot, ['down', '--remove-orphans']);
      break;
    case 'status':
      runCompose(repositoryRoot, ['ps']);
      break;
    case 'logs': {
      const logArguments = ['logs', '--tail=200'];
      if (parsedArguments.service) {
        logArguments.push(parsedArguments.service);
      }
      runCompose(repositoryRoot, logArguments);
      break;
    }
    case 'check':
      if (!runInfrastructureCheck(repositoryRoot)) {
        throw new InfraError('Infrastructure health checks failed.', 1, true);
      }
      break;
    case 'validate':
      runValidate(repositoryRoot);
      break;
    case 'reset':
      assertResetVolumesAreOwned(repositoryRoot);
      runCompose(repositoryRoot, ['down', '-v', '--remove-orphans']);
      runUp(repositoryRoot);
      break;
    default:
      throw new CliUsageError('Unsupported infrastructure command.');
  }
}

export function main(argumentsList = process.argv.slice(2)) {
  try {
    const repositoryRoot = resolveRepositoryRoot();
    const parsedArguments = parseCliArguments(argumentsList);
    executeCommand(parsedArguments, repositoryRoot);
    return 0;
  } catch (error) {
    if (!error?.reported) {
      console.error(`ERROR: ${safeErrorMessage(error)}`);
    }
    return error?.exitCode ?? 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = main();
}
