import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const operatorToken = 'web-e2e-operator-token-00000001';
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
    const response = await fetch('http://127.0.0.1:4105/internal/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aegis-source-token': process.env.RISK_IDENTITY_SOURCE_TOKEN || '',
      },
      body: JSON.stringify(event),
    });
    expect(response.ok).toBe(true);
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
  await fetch('http://127.0.0.1:4105/internal/v1/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-aegis-source-token': process.env.RISK_LEDGER_SOURCE_TOKEN || '',
    },
    body: JSON.stringify(integrity),
  });
  const assessment = await fetch(
    'http://127.0.0.1:4105/internal/v1/assessments/evaluate',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aegis-internal-token': process.env.RISK_INTERNAL_TOKEN || '',
      },
      body: JSON.stringify({
        evaluationId: randomUUID(),
        operation: 'SESSION_USE',
        subjectId: subject,
        stepUpVerified: false,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
      }),
    },
  );
  expect(assessment.ok).toBe(true);
  return subject;
}
async function signIn(page: Page) {
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
  page.once('dialog', (dialog) =>
    dialog.accept('Verified safe recovery after operator review.'),
  );
  await page.getByRole('button', { name: 'Release' }).first().click();
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
