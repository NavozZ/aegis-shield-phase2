import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const pin = '628413';

function isolatedPhone(testInfo: TestInfo): string {
  const suffix = 127 + testInfo.repeatEachIndex * 2 + testInfo.retry;
  return `+12025550${String(suffix).padStart(3, '0')}`;
}

async function demoOtp(page: Page): Promise<string> {
  const otpInput = page.getByLabel('Six-digit verification code');
  try {
    await otpInput.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    const hasError = await page
      .getByRole('alert')
      .first()
      .isVisible()
      .catch(() => false);
    throw new Error(
      hasError
        ? 'OTP request reached a safe error summary before the OTP form appeared.'
        : 'OTP form did not appear after the OTP request completed.',
    );
  }
  const code = page.locator('.demo-code').first();
  try {
    await code.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    throw new Error(
      'OTP form appeared, but the local demonstration code was absent.',
    );
  }
  const value = (await code.textContent())?.trim() || '';
  if (!/^\d{6}$/u.test(value))
    throw new Error('The local demonstration code was malformed.');
  return value;
}

/** Onboards the synthetic account-flow customer and lands on the workspace. */
async function authenticate(page: Page, phone: string) {
  await page.goto('/onboarding');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('checkbox').check();
  const otpRequest = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/v1/auth/onboarding/request-otp'),
  );
  await page.getByRole('button', { name: 'Request verification code' }).click();
  const otpResponse = await otpRequest;
  if (otpResponse.status() !== 202)
    throw new Error(`OTP request failed with status ${otpResponse.status()}.`);
  await page
    .getByLabel('Six-digit verification code')
    .fill(await demoOtp(page));
  await page.getByRole('button', { name: 'Verify code' }).click();
  await page.getByLabel('Six-digit PIN', { exact: true }).fill(pin);
  await page.getByLabel('Confirm six-digit PIN').fill(pin);
  await page
    .getByRole('button', { name: 'Create PIN and secure session' })
    .click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page
    .getByRole('button', { name: 'Continue to secure workspace' })
    .click();
  await expect(page).toHaveURL(/\/app$/u);
}

async function syntheticLedgerIds(accountId: string) {
  const pool = new pg.Pool({
    connectionString: process.env.LEDGER_DATABASE_URL,
  });
  const { rows } = await pool.query<{
    wallet_id: string;
    settlement_id: string;
  }>(
    `SELECT customer.ledger_account_id AS wallet_id, system.id AS settlement_id
     FROM app.customer_accounts AS customer
     CROSS JOIN app.ledger_accounts AS system
     WHERE customer.id = $1::uuid
       AND system.system_account_type = 'PLATFORM_SETTLEMENT_ASSET'`,
    [accountId],
  );
  await pool.end();
  if (!rows[0])
    throw new Error('Synthetic browser ledger setup was not found.');
  return rows[0];
}

async function postSynthetic(
  ids: { wallet_id: string; settlement_id: string },
  direction: 'INCOMING' | 'OUTGOING',
  amountMinor: string,
) {
  const incoming = direction === 'INCOMING';
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
        entryType: incoming ? 'SETTLEMENT_FUNDING' : 'ACCOUNT_ADJUSTMENT',
        currency: 'LKR',
        idempotencyKey: `browser-txn-${randomUUID()}`,
        reference: `JRN-BROWSER-${randomUUID()}`.slice(0, 64),
        postings: incoming
          ? [
              {
                ledgerAccountId: ids.settlement_id,
                direction: 'DEBIT',
                amountMinor,
              },
              {
                ledgerAccountId: ids.wallet_id,
                direction: 'CREDIT',
                amountMinor,
              },
            ]
          : [
              {
                ledgerAccountId: ids.wallet_id,
                direction: 'DEBIT',
                amountMinor,
              },
              {
                ledgerAccountId: ids.settlement_id,
                direction: 'CREDIT',
                amountMinor,
              },
            ],
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Synthetic browser journal failed (${response.status}).`);
}

test.describe
  .serial('@functional Tier-0 account provisioning browser journey', () => {
  test('creates one Tier-0 account, persists it across a reload and protects it after logout', async ({
    page,
  }, testInfo) => {
    await authenticate(page, isolatedPhone(testInfo));

    // 1. The workspace starts with no account.
    await expect(page.getByText('No account created yet')).toBeVisible();
    const createButton = page.getByRole('button', {
      name: 'Create Tier-0 account',
    });
    await expect(createButton).toBeVisible();

    // 2. Creating the Tier-0 account.
    await createButton.click();

    // 3. A masked reference and a real zero balance are shown.
    const maskedReference = page.getByText(/^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u);
    await expect(maskedReference).toBeVisible();
    await expect(page.getByText('LKR 0.00')).toBeVisible();
    await expect(page.getByText('Tier-0 wallet')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Receive money' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Send from this account' }),
    ).toBeVisible();
    const reference = (await maskedReference.textContent())?.trim();
    expect(reference).toMatch(/^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u);

    // The create button is gone, so the interface offers no second account.
    await expect(createButton).toHaveCount(0);

    // 4. The account survives a full reload with server-rendered data.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Secure workspace' }),
    ).toBeVisible();
    await expect(page.getByText(reference!)).toBeVisible();
    await expect(page.getByText('LKR 0.00')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create Tier-0 account' }),
    ).toHaveCount(0);

    // 5. No duplicate account was created: the gateway still lists exactly one.
    const accounts = await page.evaluate(async () => {
      const response = await fetch('http://localhost:4000/api/v1/accounts', {
        credentials: 'include',
        cache: 'no-store',
      });
      return (await response.json()) as { accounts: unknown[] };
    });
    expect(accounts.accounts).toHaveLength(1);

    const accountId = (accounts.accounts[0] as { id: string }).id;
    const ids = await syntheticLedgerIds(accountId);
    await postSynthetic(ids, 'INCOMING', '1000');
    await postSynthetic(ids, 'OUTGOING', '250');
    for (let index = 0; index < 20; index += 1)
      await postSynthetic(ids, 'INCOMING', '1');

    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Recent activity' }),
    ).toBeVisible();
    await expect(page.getByText('LKR 7.70')).toBeVisible();
    await page.getByRole('link', { name: 'View all transactions' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/accounts/${accountId}$`, 'u'),
    );
    await expect(
      page.getByRole('heading', { name: 'Transaction history' }),
    ).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(20);
    await page.getByLabel('Direction').selectOption('OUTGOING');
    await expect(page).toHaveURL(/direction=OUTGOING/u);
    await expect(page.getByText('−LKR 2.50')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(22);
    const links = await page
      .locator('.transaction-list a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
    expect(new Set(links).size).toBe(links.length);
    await page.getByText('−LKR 2.50').click();
    await expect(
      page.getByRole('heading', { name: 'Prototype transaction record' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /ledgerAccountId|customerId|createdBy|correlationId|metadata/u,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(page.locator('.receipt')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Prototype transaction record' }),
    ).toBeVisible();
    await expect(page.getByText(/not proof of payment/iu)).toBeVisible();

    await page.goto(`/app/accounts/${accountId}/transactions/${randomUUID()}`);
    await expect(page.getByRole('status')).toContainText(/not found/iu);
    await page.goto('/app');

    // The owner can see the receiving reference, but internal identifiers never
    // reach the page.
    await expect(page.locator('body')).not.toContainText(
      /ledgerAccountId|customerId|createdBy|correlationId|metadata/u,
    );

    // 6. Logging out and confirming the protected route redirects.
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in$/u);
    await expect(page.locator('body')).not.toContainText('LKR 0.00');
  });
});
