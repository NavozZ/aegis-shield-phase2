/**
 * Demonstration evidence capture.
 *
 *   pnpm demo:evidence
 *
 * Drives the browser over the public customer journeys and writes screenshots to
 * an ignored directory for a human to review before any of it is shared.
 *
 * What this deliberately does NOT do:
 *
 *   - It never commits. `.evidence/` is git-ignored and nothing here runs git.
 *   - It never uploads. There is no network destination in this file.
 *   - It never captures an authenticated secret. Every page it visits is either
 *     public or reached with synthetic demonstration data, and each captured
 *     page's text is scanned for one-time codes, PINs, cookies, tokens and full
 *     account references before the run is allowed to succeed.
 *
 * Screenshots are images and cannot be scanned the way text can, which is why
 * the run also captures each page's visible text and refuses to finish if that
 * text contains anything sensitive. That is a guard against a page starting to
 * render something it should not, not a substitute for the manual review the
 * final notice insists on.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

/** Where evidence lands. Git-ignored; never inside a published directory. */
export const EVIDENCE_DIRECTORY = '.evidence';

/** The two viewports every capture is taken at. */
export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

/**
 * The pages captured, in order.
 *
 * Unauthenticated routes only. Everything under `/app` is behind
 * `apps/web/src/app/app/layout.tsx`, which redirects a visitor with no session
 * to `/sign-in` — capturing those would produce screenshots of the sign-in page
 * labelled as the QR, USSD and agent channels, which is worse than no evidence.
 * Signing in to reach them is not an option either: an authenticated capture
 * renders real references and amounts, and an image of one discloses as much as
 * the page.
 *
 * The channel, security-posture and SABCL screens are therefore demonstrated
 * live rather than captured. See ../../docs/release/FINAL_DEMO_GUIDE.md.
 */
export const EVIDENCE_PAGES = [
  { key: 'home', route: '/', title: 'Landing page' },
  { key: 'sign-in', route: '/sign-in', title: 'Customer sign-in' },
  { key: 'onboarding', route: '/onboarding', title: 'Tier-0 onboarding' },
  {
    key: 'security-ops-sign-in',
    route: '/security-ops/sign-in',
    title: 'Operator sign-in',
  },
];

/**
 * A deterministic file name.
 *
 * Deterministic so re-running overwrites rather than accumulating, and so a
 * reviewer can tell at a glance which page and viewport an image came from. No
 * timestamp: a timestamped name makes every run a new file to review.
 */
export function evidenceFileName(pageKey, viewportName) {
  const index = EVIDENCE_PAGES.findIndex((page) => page.key === pageKey);
  if (index < 0) throw new Error('Unknown evidence page.');
  if (!VIEWPORTS.some((viewport) => viewport.name === viewportName)) {
    throw new Error('Unknown viewport.');
  }
  return `${String(index + 1).padStart(2, '0')}-${pageKey}-${viewportName}.png`;
}

export function expectedEvidenceFiles() {
  return EVIDENCE_PAGES.flatMap((page) =>
    VIEWPORTS.map((viewport) => evidenceFileName(page.key, viewport.name)),
  );
}

/**
 * Patterns that must never appear in captured page text.
 *
 * Each is a thing the demonstration would disclose if a page rendered it: a
 * one-time code, a PIN, a cookie or token, or a full account reference.
 */
export const FORBIDDEN_TEXT_PATTERNS = [
  { name: 'one-time code', pattern: /\b\d{6}\b/u },
  { name: 'PIN', pattern: /\bPIN\s*[:=]\s*\d+/iu },
  { name: 'session cookie', pattern: /aegis_(session|operator_session)\s*=/u },
  { name: 'CSRF token', pattern: /aegis_(csrf|operator_csrf)\s*=/u },
  { name: 'internal token', pattern: /x-aegis-(internal|source)-token/iu },
  { name: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/u },
  { name: 'connection string', pattern: /postgres(ql)?:\/\/|redis:\/\// },
  // A full local account reference. Masked previews keep their ellipsis and are
  // therefore allowed.
  { name: 'account reference', pattern: /\bLK\d{2}[ ]?(?:\d{4}[ ]?){3,}/u },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
];

/**
 * Scans captured text and returns the names of anything sensitive found.
 *
 * Returns names, never the matched value: a sanitizer that echoed what it caught
 * would put the secret into the log that reports the problem.
 */
export function scanCapturedText(text) {
  const found = [];
  for (const { name, pattern } of FORBIDDEN_TEXT_PATTERNS) {
    if (pattern.test(String(text ?? ''))) found.push(name);
  }
  return found;
}

export function formatEvidenceNotice(files) {
  return [
    '',
    `[evidence] wrote ${String(files.length)} screenshots to ${EVIDENCE_DIRECTORY}/`,
    '',
    '[evidence] MANUAL REVIEW REQUIRED',
    '[evidence] These images have not been reviewed by a person. Open every one',
    '[evidence] before sharing, submitting or attaching any of them. Automated',
    '[evidence] scanning covers page text only; an image can show something the',
    '[evidence] text scan cannot see.',
    '',
    `[evidence] ${EVIDENCE_DIRECTORY}/ is git-ignored. Nothing was committed and`,
    '[evidence] nothing was uploaded.',
    '',
  ].join('\n');
}

export function buildPlaywrightInvocation(repositoryRoot) {
  return {
    command: 'pnpm',
    // An argument array, never a shell string.
    arguments: [
      '--filter',
      '@aegis/web',
      'exec',
      'playwright',
      'test',
      '--grep',
      '@evidence',
    ],
    options: { cwd: repositoryRoot, shell: process.platform === 'win32' },
  };
}

export function main(log = console.log, options = {}) {
  const repositoryRoot = options.repositoryRoot ?? resolveRepositoryRoot();
  const invocation = buildPlaywrightInvocation(repositoryRoot);
  log('[evidence] capturing synthetic demonstration screenshots');
  log(
    '[evidence] synthetic data only; no OTP, PIN, cookie or token is entered',
  );
  const run = options.run ?? spawnSync;
  const result = run(invocation.command, invocation.arguments, {
    ...invocation.options,
    stdio: 'inherit',
    windowsHide: true,
  });
  if ((result.status ?? 1) !== 0) {
    log('[evidence] capture failed; no evidence was produced');
    return 1;
  }
  log(formatEvidenceNotice(expectedEvidenceFiles()));
  return 0;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) {
  process.exitCode = main();
}
