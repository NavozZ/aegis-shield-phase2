import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Demonstration evidence capture.
 *
 * Screenshots of the public, synthetic journeys for a human to review before
 * anything is shared. Run through `pnpm demo:evidence`, which owns the notice
 * and the file naming; this spec owns the browser.
 *
 * No credential is ever entered here. Every page below is either public or
 * reachable without signing in, so nothing captured can contain a session, a
 * one-time code, a PIN or a customer reference. Pages that render a real
 * reference or amount — account detail, transfer receipts, operator incidents —
 * are deliberately absent.
 *
 * Each page's visible text is scanned before its screenshot is accepted. An
 * image cannot be scanned the way text can, so this is a guard against a page
 * starting to render something it should not, never a substitute for the manual
 * review the tooling insists on.
 */

const EVIDENCE_DIRECTORY = resolve(process.cwd(), '..', '..', '.evidence');

/**
 * Unauthenticated routes only; mirrors infra/scripts/evidence.mjs.
 *
 * Everything under `/app` redirects a visitor with no session to `/sign-in`, so
 * capturing it would file a screenshot of the sign-in page under a channel's
 * name. The assertion below makes that failure loud rather than silent.
 */
const PAGES = [
  { key: 'home', route: '/' },
  { key: 'sign-in', route: '/sign-in' },
  { key: 'onboarding', route: '/onboarding' },
  { key: 'security-ops-sign-in', route: '/security-ops/sign-in' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Mirrors infra/scripts/evidence.mjs. Names only; never the matched value. */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'one-time code', pattern: /\b\d{6}\b/u },
  { name: 'PIN', pattern: /\bPIN\s*[:=]\s*\d+/iu },
  { name: 'session cookie', pattern: /aegis_(session|operator_session)\s*=/u },
  { name: 'CSRF token', pattern: /aegis_(csrf|operator_csrf)\s*=/u },
  { name: 'internal token', pattern: /x-aegis-(internal|source)-token/iu },
  { name: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/u },
  { name: 'connection string', pattern: /postgres(ql)?:\/\/|redis:\/\// },
  { name: 'account reference', pattern: /\bLK\d{2}[ ]?(?:\d{4}[ ]?){3,}/u },
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
];

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
});

for (const [index, page] of PAGES.entries()) {
  for (const viewport of VIEWPORTS) {
    test(`evidence ${page.key} ${viewport.name} @evidence`, async ({
      page: browserPage,
    }) => {
      await browserPage.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const response = await browserPage.goto(page.route, {
        waitUntil: 'networkidle',
      });

      // A 404 or a redirect to sign-in would otherwise be screenshotted and
      // filed under the requested page's name. Both are caught here.
      expect(response?.status(), `${page.route} did not return 200`).toBe(200);
      expect(
        new URL(browserPage.url()).pathname.replace(/\/$/u, '') || '/',
        `${page.route} redirected elsewhere`,
      ).toBe(page.route);
      await expect(browserPage.locator('h1').first()).toBeVisible();

      const text = (await browserPage.locator('body').innerText()) ?? '';
      const found = FORBIDDEN.filter((entry) => entry.pattern.test(text)).map(
        (entry) => entry.name,
      );
      // Named, never quoted: a failure message that echoed the match would put
      // the secret into the CI log that reports it.
      expect(
        found,
        `${page.route} rendered sensitive content: ${found.join(', ')}`,
      ).toEqual([]);

      const name = `${String(index + 1).padStart(2, '0')}-${page.key}-${viewport.name}.png`;
      await browserPage.screenshot({
        path: resolve(EVIDENCE_DIRECTORY, name),
        fullPage: true,
      });
    });
  }
}
