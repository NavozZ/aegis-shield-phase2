import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Command and document validation.
 *
 * Documentation drifts silently. A command that was renamed, a document that
 * was moved, a link to a file that no longer exists — none of these break a
 * build, and all of them waste the time of the next person who follows the
 * instructions. This suite makes that drift a test failure.
 */

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const packageScripts = Object.keys(
  JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))
    .scripts,
);

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  'generated',
  '.dr-backups',
  '.evidence',
  '.playwright-report',
  '.playwright-artifacts',
]);

function markdownFiles(directory = repositoryRoot) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(path));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

const DOCUMENTS = markdownFiles();

/**
 * Commands documented as belonging to another tool, not this workspace.
 *
 * `pnpm install`, `pnpm exec` and friends are pnpm's own; `pnpm --filter X cmd`
 * targets a workspace package rather than a root script.
 */
const PNPM_BUILTINS = new Set([
  'install',
  'exec',
  'run',
  'add',
  'remove',
  'update',
  'why',
  'audit',
  'dlx',
  'store',
  'list',
  'outdated',
  'setup',
  'rebuild',
  'link',
  'publish',
  'pack',
  'test',
]);

test('every documented pnpm command exists in package.json', () => {
  const unknown = [];
  for (const file of DOCUMENTS) {
    const text = readFileSync(file, 'utf8');
    for (const [lineNumber, line] of text.split(/\r?\n/u).entries()) {
      for (const match of line.matchAll(/pnpm\s+(-{0,2}[\w:@/.-]+)/gu)) {
        const candidate = match[1];
        // Flags and workspace-filtered invocations are pnpm's own surface.
        if (candidate.startsWith('-')) break;
        if (PNPM_BUILTINS.has(candidate)) continue;
        if (!candidate.includes(':') && packageScripts.includes(candidate)) {
          continue;
        }
        if (packageScripts.includes(candidate)) continue;
        // A colon-free word that is not a script is prose, not a command.
        if (!candidate.includes(':')) continue;
        unknown.push(
          `${relative(repositoryRoot, file)}:${String(lineNumber + 1)} → pnpm ${candidate}`,
        );
      }
    }
  }
  assert.deepEqual(unknown, [], 'documented commands that do not exist');
});

test('every capability command is documented somewhere', () => {
  // Internal plumbing is exempt: nobody reads documentation to find `db:migrate:risk`.
  const internal =
    /^(dev|build|lint|typecheck|format|format:check|clean|test|db:migrate:|db:validate:|db:generate:|db:deploy:|stack:start|dev:full|web:e2e:install|web:test:transactions|infra:logs|infra:status)/u;
  const corpus = DOCUMENTS.map((file) => readFileSync(file, 'utf8')).join('\n');
  const undocumented = packageScripts
    .filter((name) => !internal.test(name))
    .filter((name) => !corpus.includes(`pnpm ${name}`));
  assert.deepEqual(undocumented, [], 'commands nobody documented');
});

test('every release document exists', () => {
  for (const name of [
    'docs/release/FINAL_DEMO_GUIDE.md',
    'docs/release/SUBMISSION_CHECKLIST.md',
    'docs/release/FINAL_VALIDATION_REPORT.md',
    'docs/release/RELEASE_NOTES.md',
    'docs/release/final-capability-audit.md',
    'docs/release/final-security-review.md',
  ]) {
    assert.ok(existsSync(resolve(repositoryRoot, name)), `${name} is missing`);
  }
});

test('every relative markdown link points at a file that exists', () => {
  const broken = [];
  for (const file of DOCUMENTS) {
    const text = readFileSync(file, 'utf8');
    for (const [lineNumber, line] of text.split(/\r?\n/u).entries()) {
      for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
        const target = match[1].split('#')[0].trim();
        if (!target || /^(https?:|mailto:|#)/u.test(target)) continue;
        const resolved = target.startsWith('/')
          ? resolve(repositoryRoot, target.slice(1))
          : resolve(dirname(file), target);
        if (!existsSync(resolved)) {
          broken.push(
            `${relative(repositoryRoot, file)}:${String(lineNumber + 1)} → ${target}`,
          );
        }
      }
    }
  }
  assert.deepEqual(broken, [], 'markdown links pointing at missing files');
});

test('no document claims an implemented capability is deferred', () => {
  // Every one of these shipped. A document still calling one future is worse
  // than no document: it tells a reader the platform cannot do something it can.
  const stale = [
    /to be completed during implementation/iu,
    /no security operations console exists yet/iu,
    /\bfour (logically isolated )?(prototype )?databases\b/iu,
  ];
  const offenders = [];
  for (const file of DOCUMENTS) {
    const relativePath = relative(repositoryRoot, file);
    // The demonstration index legitimately lists journeys not yet scripted.
    const text = readFileSync(file, 'utf8');
    for (const [lineNumber, line] of text.split(/\r?\n/u).entries()) {
      for (const pattern of stale) {
        if (pattern.test(line)) {
          offenders.push(
            `${relativePath}:${String(lineNumber + 1)} → ${line.trim().slice(0, 80)}`,
          );
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'documents claiming shipped work is deferred',
  );
});

test('every documented service port matches the implemented stack', () => {
  // A port list that omits Resilience sends an operator to a service that is
  // not there. Any document that lists the stack must list all of it.
  const ports = [
    '3000',
    '4000',
    '4101',
    '4102',
    '4103',
    '4104',
    '4105',
    '4106',
  ];
  const stackDocuments = [
    'README.md',
    'docs/architecture/README.md',
    'docs/release/FINAL_DEMO_GUIDE.md',
  ];
  for (const name of stackDocuments) {
    const path = resolve(repositoryRoot, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const missing = ports.filter((port) => !text.includes(port));
    assert.deepEqual(missing, [], `${name} omits ports`);
  }
});

test('the release documents are real documents, not placeholders', () => {
  const releaseDirectory = resolve(repositoryRoot, 'docs', 'release');
  if (!existsSync(releaseDirectory)) return;
  for (const name of readdirSync(releaseDirectory)) {
    const path = join(releaseDirectory, name);
    if (!name.endsWith('.md') || !statSync(path).isFile()) continue;
    const text = readFileSync(path, 'utf8');
    assert.ok(text.length > 800, `${name} is too short to be a real document`);
    assert.ok(text.startsWith('# '), `${name} has no title`);
    assert.ok(
      !/\bTODO\b|\bTBD\b|to be completed/iu.test(text),
      `${name} still contains a placeholder`,
    );
  }
});
