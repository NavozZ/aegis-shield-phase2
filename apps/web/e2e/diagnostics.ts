import type { Page } from '@playwright/test';

/*
 * Safe failure diagnostics for browser journeys.
 *
 * When a locator times out, Playwright reports the selector and nothing about
 * why the page was in the state it was. That is how the transfer journey failed
 * for a while: "waiting for getByLabel('Six-digit verification code')" with no
 * hint that the request behind it had been rate-limited.
 *
 * Everything gathered here is deliberately non-sensitive. It never reads OTP or
 * PIN values, cookies, session state, tokens, authentication headers or request
 * bodies — the point is to explain the *shape* of the failure, not to dump the
 * page. Screenshots and traces continue to carry the detail, under Playwright's
 * own artifact handling.
 */

/** Values that must never reach a CI log, even from a "safe" element. */
const SENSITIVE_TEXT = /\b\d{4,8}\b/gu;

/** Redacts anything that looks like a code, so a demo OTP cannot leak. */
function scrub(value: string): string {
  return value.replace(SENSITIVE_TEXT, '[redacted]').slice(0, 300);
}

export interface JourneyDiagnostics {
  phase: string;
  url: string;
  heading: string;
  otpFieldPresent: boolean;
  alert: string;
  rateLimited: boolean;
}

/**
 * Collects a small, safe snapshot of the page.
 *
 * Every lookup is defensive: diagnostics must never themselves throw and mask
 * the original failure.
 */
export async function collectDiagnostics(
  page: Page,
  phase: string,
): Promise<JourneyDiagnostics> {
  const safely = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch {
      return fallback;
    }
  };

  const heading = await safely(
    async () =>
      scrub(
        (await page.locator('h1').first().textContent({ timeout: 1_000 })) ??
          '',
      ),
    '',
  );
  const alert = await safely(
    async () =>
      scrub(
        (await page
          .locator('[role="alert"]')
          .first()
          .textContent({ timeout: 1_000 })) ?? '',
      ),
    '',
  );
  const otpFieldPresent = await safely(
    async () =>
      (await page.getByLabel('Six-digit verification code').count()) > 0,
    false,
  );

  return {
    phase,
    url: page.url(),
    heading,
    otpFieldPresent,
    alert,
    // The specific signal the transfer journey needed: was the step blocked by
    // the rate limiter rather than by a genuine application error?
    rateLimited: /too many requests|rate.?limit/iu.test(alert),
  };
}

/**
 * Formats diagnostics for a thrown error message.
 *
 * Attached to the failure rather than printed, so it travels with the assertion
 * in the CI summary instead of being lost in interleaved stdout.
 */
export function describeDiagnostics(diagnostics: JourneyDiagnostics): string {
  return [
    `phase=${diagnostics.phase}`,
    `url=${diagnostics.url}`,
    `heading="${diagnostics.heading}"`,
    `otpFieldPresent=${String(diagnostics.otpFieldPresent)}`,
    `rateLimited=${String(diagnostics.rateLimited)}`,
    diagnostics.alert ? `alert="${diagnostics.alert}"` : 'alert=(none)',
  ].join(' ');
}

/** Runs a step and, on failure, rethrows with safe context attached. */
export async function withDiagnostics<T>(
  page: Page,
  phase: string,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    const diagnostics = await collectDiagnostics(page, phase);
    const original = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${original}\n--- journey state ---\n${describeDiagnostics(diagnostics)}`,
    );
  }
}
