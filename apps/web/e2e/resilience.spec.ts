import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { withDiagnostics } from './diagnostics';

/*
 * The recovery operations console, end to end.
 *
 * The journey mirrors what an operator actually does after a drill runs: sign
 * in, read recovery readiness, read the drill history, and acknowledge a
 * failure. The drill itself is created through the Resilience service's
 * internal API the way the CLI tooling creates it, because the console has no
 * control that runs one — and this test asserts that too.
 */

const operatorToken = 'web-e2e-operator-token-00000001';
const resilienceUrl =
  process.env.RESILIENCE_SERVICE_URL || 'http://127.0.0.1:4106';

/** Posts to the Resilience service and drains the body, as the CLI does. */
async function postToResilience(
  path: string,
  payload: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${resilienceUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'x-aegis-source-token':
        process.env.RESILIENCE_TOOLING_SOURCE_TOKEN ||
        process.env.RESILIENCE_INTERNAL_TOKEN ||
        '',
      'x-correlation-id': randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text().catch(() => '');
  return {
    ok: response.ok,
    status: response.status,
    body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined,
  };
}

/** Records a drill that failed, so the console has something to acknowledge. */
async function seedFailedDrill(): Promise<string> {
  const created = await postToResilience(
    `/internal/v1/drills?requestedBy=operator:e2e-recovery`,
    { type: 'CI_AUTOMATED', note: 'Browser journey drill' },
  );
  expect(created.ok, `Drill creation returned ${String(created.status)}`).toBe(
    true,
  );
  const drillId = (created.body as { drillId: string }).drillId;

  const running = await postToResilience(
    `/internal/v1/drills/${drillId}/advance`,
    { state: 'RUNNING', note: 'Creating encrypted backup set' },
  );
  expect(
    running.ok,
    `Advance to RUNNING returned ${String(running.status)}`,
  ).toBe(true);

  const failed = await postToResilience(
    `/internal/v1/drills/${drillId}/advance`,
    {
      state: 'FAILED',
      failureCode: 'RESTORE_FAILED',
      note: 'Controlled failure for the browser journey',
    },
  );
  expect(failed.ok, `Advance to FAILED returned ${String(failed.status)}`).toBe(
    true,
  );
  return drillId;
}

async function signIn(page: Page) {
  await withDiagnostics(page, 'operator sign-in', async () => {
    await page.goto('/security-ops/sign-in');
    await page
      .getByLabel('Development operator access token')
      .fill(operatorToken);
    await page
      .getByRole('button', { name: 'Open security console' })
      .press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Risk operations overview' }),
    ).toBeVisible();
  });
}

test('operator reads recovery readiness and acknowledges a failed drill @functional', async ({
  page,
}) => {
  // Unauthenticated access is refused before any recovery evidence is fetched.
  await page.goto('/security-ops/resilience');
  await expect(page).toHaveURL(/security-ops\/sign-in/u);

  await seedFailedDrill();
  await signIn(page);

  await page.goto('/security-ops/resilience');
  await expect(
    page.getByRole('heading', { name: 'Recovery operations' }),
  ).toBeVisible();

  // Readiness is rendered, and the measurements are labelled as prototype
  // figures rather than as objectives.
  await expect(page.getByText('Platform state')).toBeVisible();
  await expect(
    page.getByText('Measured prototype recovery-point age'),
  ).toBeVisible();
  await expect(
    page.getByText('Measured prototype recovery duration'),
  ).toBeVisible();

  // Nothing on this page runs a backup or a restore.
  const buttonLabels = await page
    .getByRole('button')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').toLowerCase()),
    );
  for (const label of buttonLabels) {
    expect(label).not.toContain('run backup');
    expect(label).not.toContain('restore now');
  }

  // Acknowledge the seeded failure through the audited prompt.
  const acknowledge = page
    .getByRole('button', { name: /Acknowledge RESTORE_FAILED/u })
    .first();
  await expect(acknowledge).toBeVisible();
  page.once('dialog', (dialog) =>
    dialog.accept(
      'Reviewed; controlled failure seeded by the browser journey.',
    ),
  );
  await acknowledge.click();
  await expect(
    page.getByText('The failed drill was acknowledged.'),
  ).toBeVisible();

  // The console must never render connection details, keys or dump paths.
  const markup = await page.content();
  for (const forbidden of [
    'postgresql://',
    'PGPASSWORD',
    'DR_BACKUP_ENCRYPTION_KEY',
    '.dump.enc',
    'x-aegis-internal-token',
  ]) {
    expect(markup).not.toContain(forbidden);
  }

  // Mobile layout: no horizontal scroll at a common small-phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('the recovery console has no serious axe violations @a11y', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/security-ops/resilience');
  await expect(
    page.getByRole('heading', { name: 'Recovery operations' }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    ),
  ).toEqual([]);
});
