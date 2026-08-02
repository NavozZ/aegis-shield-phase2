import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { withDiagnostics } from './diagnostics';

const operatorToken = 'web-e2e-operator-token-00000001';

/**
 * Posts to the Risk service and reads the body to completion.
 *
 * `connection: close` plus draining stops Node's keep-alive pool holding a
 * socket open past the test, which would otherwise keep the Playwright process
 * alive after the run.
 */
async function postToRisk(
  path: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(`http://127.0.0.1:4105${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  await response.text().catch(() => '');
  return { ok: response.ok, status: response.status };
}
async function seedCriticalIncident() {
  const subject = `subject:e2e:${randomUUID()}`;
  for (let index = 0; index < 5; index += 1) {
    const event = {
      schemaVersion: '1.0',
      eventId: randomUUID(),
      source: 'IDENTITY',
      sourceEventId: `identity:e2e:${randomUUID()}`,
      eventType: 'LOGIN_FAILURE',
      severity: 'MEDIUM',
      occurredAt: new Date().toISOString(),
      subjectId: subject,
      correlationId: randomUUID(),
      attributes: { outcome: 'FAILURE', operation: 'LOGIN' },
    };
    const response = await postToRisk(
      '/internal/v1/events',
      { 'x-aegis-source-token': process.env.RISK_IDENTITY_SOURCE_TOKEN || '' },
      event,
    );
    // Naming the status makes a Risk-service problem obvious instead of showing
    // up later as an empty console.
    expect(
      response.ok,
      `Risk event ingestion returned ${response.status}`,
    ).toBe(true);
  }
  const integrity = {
    schemaVersion: '1.0',
    eventId: randomUUID(),
    source: 'LEDGER',
    sourceEventId: `ledger:e2e:${randomUUID()}`,
    eventType: 'INTEGRITY_FAILURE',
    severity: 'CRITICAL',
    occurredAt: new Date().toISOString(),
    subjectId: subject,
    correlationId: randomUUID(),
    attributes: { integrityCode: 'E2E_RECONCILIATION' },
  };
  const integrityResponse = await postToRisk(
    '/internal/v1/events',
    { 'x-aegis-source-token': process.env.RISK_LEDGER_SOURCE_TOKEN || '' },
    integrity,
  );
  expect(
    integrityResponse.ok,
    `Risk integrity ingestion returned ${integrityResponse.status}`,
  ).toBe(true);

  const assessment = await postToRisk(
    '/internal/v1/assessments/evaluate',
    { 'x-aegis-internal-token': process.env.RISK_INTERNAL_TOKEN || '' },
    {
      evaluationId: randomUUID(),
      operation: 'SESSION_USE',
      subjectId: subject,
      stepUpVerified: false,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
    },
  );
  expect(
    assessment.ok,
    `Risk assessment evaluation returned ${assessment.status}`,
  ).toBe(true);
  return subject;
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

test('operator triages escalating risk, releases control and resolves incident @functional', async ({
  page,
}) => {
  await page.goto('/security-ops');
  await expect(page).toHaveURL(/security-ops\/sign-in/u);
  await seedCriticalIncident();
  await signIn(page);
  await expect(
    page.getByText('CRITICAL · score', { exact: false }).first(),
  ).toBeVisible();
  const incident = page
    .getByRole('link', { name: /Automated critical risk assessment/iu })
    .first();
  await incident.click();
  await page
    .getByLabel('Assign operator identifier')
    .fill('operator:e2e-reviewer');
  await page.getByRole('button', { name: 'Assign and investigate' }).click();
  await expect(page.getByText('STATUS_CHANGED').first()).toBeVisible();
  page.once('dialog', (dialog) =>
    dialog.accept('Verified recovery after controlled e2e threat.'),
  );
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText(/RESOLVED/u).first()).toBeVisible();
  await page.getByRole('link', { name: /Security Operations/u }).click();

  // Drain the active-control list completely.
  //
  // The assertion at the end is that the console shows no active controls, and
  // that only follows from releasing one control if exactly one exists. Two
  // things break that assumption. The console renders a bounded page with a
  // "Load more controls" button, so the first page emptying does not mean the
  // list is empty. And this branch integrates the inclusive channels and SABCL
  // Jest transfer end-to-end now writes Risk controls to the same database
  // earlier in the CI job — this journey is no longer the only producer.
  //
  // Nothing here is relaxed: no timeout replaces a state assertion, every
  // release still asserts the list shrank, and both bounds fail loudly rather
  // than passing on exhaustion.

  // Confirm we are actually on the dashboard first. Both the control list and
  // the empty-state message live here, so asserting either while the browser is
  // still on the incident page yields "zero controls and no empty state" —
  // which is what CI reported and which says nothing about the control list.
  // The console keeps its operator session in memory, so navigation must stay
  // in-app; a hard reload returns to the sign-in screen.
  await expect(
    page.getByRole('heading', { name: 'Risk operations overview' }),
  ).toBeVisible();

  const release = page.getByRole('button', { name: 'Release' });
  const showMore = page.getByRole('button', { name: 'Load more controls' });

  // Expand every page of controls so the list below is the whole list.
  for (let expand = 0; expand < 15 && (await showMore.count()) > 0; expand++) {
    await showMore.first().click();
  }

  for (let pass = 0; pass < 25; pass += 1) {
    const remaining = await release.count();
    if (remaining === 0) break;
    page.once('dialog', (dialog) =>
      dialog.accept('Verified safe recovery after operator review.'),
    );
    await release.first().click();
    // The released control must leave the list, or we would spin on one the
    // operator cannot release.
    await expect(release).toHaveCount(remaining - 1);
  }

  await expect(release).toHaveCount(0);
  await expect(page.getByText('No active controls.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('operator sign-in and dashboard have no serious axe violations @a11y', async ({
  page,
}) => {
  await page.goto('/security-ops/sign-in');
  let results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    ),
  ).toEqual([]);
  await signIn(page);
  results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    ),
  ).toEqual([]);
});
