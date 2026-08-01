import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const phone = '+12025550126';
const pin = '846291';

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    violations,
    `${label} serious or critical accessibility violations`,
  ).toEqual([]);
}

async function addSyntheticFunding(accountId: string): Promise<void> {
  const pool = new pg.Pool({
    connectionString: process.env.LEDGER_DATABASE_URL,
  });
  const { rows } = await pool.query<{
    wallet_id: string;
    settlement_id: string;
  }>(
    `SELECT customer.ledger_account_id AS wallet_id, system.id AS settlement_id
     FROM app.customer_accounts AS customer CROSS JOIN app.ledger_accounts AS system
     WHERE customer.id = $1::uuid AND system.system_account_type = 'PLATFORM_SETTLEMENT_ASSET'`,
    [accountId],
  );
  await pool.end();
  const ids = rows[0];
  if (!ids)
    throw new Error('Synthetic accessibility ledger setup was not found.');
  const response = await fetch(
    `${process.env.LEDGER_SERVICE_URL}/internal/journal-entries`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aegis-internal-token': process.env.LEDGER_INTERNAL_TOKEN!,
        'x-correlation-id': randomUUID(),
      },
      body: JSON.stringify({
        entryType: 'SETTLEMENT_FUNDING',
        currency: 'LKR',
        idempotencyKey: `a11y-${randomUUID()}`,
        reference: `JRN-A11Y-${randomUUID()}`.slice(0, 64),
        postings: [
          {
            ledgerAccountId: ids.settlement_id,
            direction: 'DEBIT',
            amountMinor: '100',
          },
          {
            ledgerAccountId: ids.wallet_id,
            direction: 'CREDIT',
            amountMinor: '100',
          },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `Synthetic accessibility journal failed (${response.status}).`,
    );
}

test('@a11y authentication surfaces have no serious or critical axe violations', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expectAccessible(page, 'landing page');
  await page.goto('/sign-in');
  await expectAccessible(page, 'sign-in page');
  await page.goto('/onboarding');
  await expectAccessible(page, 'onboarding phone step');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request verification code' }).click();
  await expectAccessible(page, 'onboarding OTP step');
  const otp = (await page.locator('.demo-code').textContent())?.trim() || '';
  await page.getByLabel('Six-digit verification code').fill(otp);
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expectAccessible(page, 'onboarding PIN step');
  await page.getByLabel('Six-digit PIN', { exact: true }).fill(pin);
  await page.getByLabel('Confirm six-digit PIN').fill(pin);
  await page
    .getByRole('button', { name: 'Create PIN and secure session' })
    .click();
  await expectAccessible(page, 'passkey enrollment step');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page
    .getByRole('button', { name: 'Continue to secure workspace' })
    .click();
  await expect(page).toHaveURL(/\/app$/u);
  await expectAccessible(page, 'protected application page without an account');
  await page.getByRole('button', { name: 'Create Tier-0 account' }).click();
  await expect(page.getByText('LKR 0.00')).toBeVisible();
  await expectAccessible(page, 'dashboard with account and no activity');
  const accounts = await page.evaluate(
    async () =>
      (
        await fetch('http://localhost:4000/api/v1/accounts', {
          credentials: 'include',
          cache: 'no-store',
        })
      ).json() as Promise<{ accounts: Array<{ id: string }> }>,
  );
  const accountId = accounts.accounts[0]!.id;
  await page.goto(`/app/accounts/${accountId}`);
  await expectAccessible(page, 'empty transaction history');
  await addSyntheticFunding(accountId);
  await page.goto('/app');
  await expectAccessible(page, 'dashboard with recent activity');
  await page.setViewportSize({ width: 320, height: 800 });
  await expectAccessible(page, '320px dashboard');
  await page.goto(`/app/accounts/${accountId}`);
  await expectAccessible(page, '320px transaction history');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectAccessible(page, 'transaction history');
  await page.getByLabel('Direction').selectOption('OUTGOING');
  await expectAccessible(page, 'empty filtered transaction history');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('listitem').first().getByRole('link').click();
  await expectAccessible(page, 'transaction detail record');
  await page.goto('/app/security');
  await expectAccessible(page, 'security settings page');

  await page.goto('/app/transfers');
  await expectAccessible(page, 'transfer list');
  await page.setViewportSize({ width: 320, height: 800 });
  await expectAccessible(page, 'mobile transfer list');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app/transfers/new');
  await expectAccessible(page, 'transfer form');

  const transferId = '44444444-4444-4444-8444-444444444444';
  const createdAt = '2026-08-01T10:00:00.000Z';
  await page.route('**/api/v1/transfers/preview', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        intentToken: 'a'.repeat(43),
        sourceMaskedReference: 'AEGIS-****-****-SRC1',
        recipientMaskedReference: 'AEGIS-****-****-DST1',
        amount: { currency: 'LKR', minorUnits: '100' },
        sourceBalance: { currency: 'LKR', minorUnits: '100' },
        policy: {
          currency: 'LKR',
          minimum: { currency: 'LKR', minorUnits: '100' },
          maximum: { currency: 'LKR', minorUnits: '5000000' },
          dailyOutgoingMaximum: { currency: 'LKR', minorUnits: '10000000' },
        },
        expiresAt: '2026-08-01T10:05:00.000Z',
      }),
    });
  });
  await page
    .getByLabel('Recipient AEGIS reference')
    .fill('AEGIS-ABCD-EFGH-JKLM');
  await page.getByLabel('Amount (LKR)').fill('1.00');
  await page.getByRole('button', { name: 'Preview transfer' }).click();
  await expectAccessible(page, 'masked transfer preview and PIN confirmation');
  await page.route('**/api/v1/transfers/confirm', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'TRANSFER_STEP_UP_FAILED',
          message: 'Authorization failed.',
        },
      }),
    });
  });
  await page.getByLabel('Enter your PIN').fill(pin);
  await page.getByRole('button', { name: 'Confirm transfer' }).click();
  await expect(page.locator('.transfer-form [role="alert"]')).toBeVisible();
  await expectAccessible(page, 'transfer authorization failure');
  await page.unroute('**/api/v1/transfers/preview');
  await page.unroute('**/api/v1/transfers/confirm');

  let processing = true;
  await page.route(`**/api/v1/transfers/${transferId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: transferId,
        displayReference: 'AEGIS-TRF-ABCD-EFGH-JKLM',
        direction: 'SENT',
        status: processing ? 'PROCESSING' : 'COMPLETED',
        accountId,
        counterpartyMaskedReference: 'AEGIS-****-****-DST1',
        amount: { currency: 'LKR', minorUnits: '100' },
        createdAt,
        completedAt: processing ? null : createdAt,
        transactionId: processing
          ? null
          : '55555555-5555-4555-8555-555555555555',
        balanceAfter: processing ? null : { currency: 'LKR', minorUnits: '0' },
        failureCode: null,
        ownMaskedReference: 'AEGIS-****-****-SRC1',
      }),
    });
  });
  await page.goto(`/app/transfers/${transferId}`);
  await expect(page.getByText('PROCESSING', { exact: true })).toBeVisible();
  await expectAccessible(page, 'processing transfer receipt');
  processing = false;
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible({
    timeout: 4_000,
  });
  await expectAccessible(page, 'completed transfer receipt');
  await page.setViewportSize({ width: 320, height: 800 });
  await expectAccessible(page, 'mobile transfer receipt');
  await page.getByLabel('Interface language').selectOption('SI');
  await expectAccessible(page, 'Sinhala transfer receipt');
  await page.getByLabel('අතුරුමුහුණත් භාෂාව').selectOption('TA');
  await expectAccessible(page, 'Tamil transfer receipt');
});
