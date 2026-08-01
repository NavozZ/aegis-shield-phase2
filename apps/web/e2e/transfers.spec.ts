import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const senderPhone = '+12025550129';
const recipientPhone = '+12025550130';
const pin = '628413';

async function demoOtp(page: Page) {
  await page
    .getByLabel('Six-digit verification code')
    .waitFor({ state: 'visible' });
  const code = page.locator('.demo-code');
  await code.waitFor({ state: 'visible' });
  const value = (await code.textContent())?.trim() ?? '';
  if (!/^\d{6}$/u.test(value)) throw new Error('Demo OTP was unavailable.');
  return value;
}
async function onboard(page: Page, phone: string) {
  await page.goto('/onboarding');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request verification code' }).click();
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
  await page.getByRole('button', { name: 'Create Tier-0 account' }).click();
  await expect(page.locator('.receive-panel code')).toBeVisible();
  const account = await page.evaluate(async () => {
    const response = await fetch('http://localhost:4000/api/v1/accounts', {
      credentials: 'include',
      cache: 'no-store',
    });
    return (await response.json()) as { accounts: Array<{ id: string }> };
  });
  return {
    id: account.accounts[0]!.id,
    reference: (await page
      .locator('.receive-panel code')
      .textContent())!.trim(),
  };
}
async function fund(accountId: string, amountMinor: string) {
  const pool = new pg.Pool({
    connectionString: process.env.LEDGER_DATABASE_URL,
  });
  const { rows } = await pool.query<{ wallet: string; settlement: string }>(
    `SELECT customer.ledger_account_id AS wallet, system.id AS settlement
     FROM app.customer_accounts customer CROSS JOIN app.ledger_accounts system
     WHERE customer.id=$1::uuid AND system.system_account_type='PLATFORM_SETTLEMENT_ASSET'`,
    [accountId],
  );
  await pool.end();
  const ids = rows[0];
  if (!ids) throw new Error('Funding accounts missing.');
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
        idempotencyKey: `browser-transfer-fund-${randomUUID()}`,
        reference: `JRN-BROWSER-TRANSFER-${randomUUID()}`.slice(0, 64),
        postings: [
          { ledgerAccountId: ids.settlement, direction: 'DEBIT', amountMinor },
          { ledgerAccountId: ids.wallet, direction: 'CREDIT', amountMinor },
        ],
      }),
    },
  );
  if (!response.ok) throw new Error(`Funding failed (${response.status}).`);
}
async function openPreview(page: Page, reference: string, amount: string) {
  await page.goto('/app/transfers/new');
  await page.getByLabel('Recipient AEGIS reference').fill(reference);
  await page.getByLabel('Amount (LKR)').fill(amount);
  await page.getByRole('button', { name: 'Preview transfer' }).click();
  await expect(
    page.getByRole('heading', { name: 'Review transfer' }),
  ).toBeVisible();
}
async function balance(page: Page, accountId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(
      `http://localhost:4000/api/v1/accounts/${id}/balance`,
      { credentials: 'include', cache: 'no-store' },
    );
    return (await response.json()) as { balance: { minorUnits: string } };
  }, accountId);
}
async function expireLatestIntent(accountId: string) {
  const pool = new pg.Pool({
    connectionString: process.env.PAYMENTS_DATABASE_URL,
  });
  await pool.query(
    `UPDATE app.transfer_intents SET expires_at=now()-interval '1 minute'
     WHERE id=(SELECT id FROM app.transfer_intents WHERE source_account_id=$1::uuid ORDER BY created_at DESC LIMIT 1)`,
    [accountId],
  );
  await pool.end();
}
async function close(context: BrowserContext) {
  await context.close();
}

test('@functional real two-customer transfer browser journey', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const senderContext = await browser.newContext();
  const recipientContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const recipient = await recipientContext.newPage();
  try {
    const senderAccount = await onboard(sender, senderPhone);
    const recipientAccount = await onboard(recipient, recipientPhone);
    await fund(senderAccount.id, '100000');

    await openPreview(sender, recipientAccount.reference, '100.00');
    await expect(
      sender.getByText(/^AEGIS-\*{4}-\*{4}-[A-Z0-9]{4}$/u).last(),
    ).toBeVisible();
    await sender.getByLabel('Enter your PIN').fill('111111');
    await sender.getByRole('button', { name: 'Confirm transfer' }).click();
    await expect(sender.locator('.transfer-form [role="alert"]')).toContainText(
      /PIN was incorrect/u,
    );
    await sender.getByLabel('Enter your PIN').fill(pin);
    let confirmation: Request | undefined;
    sender.on('request', (request) => {
      if (request.url().endsWith('/api/v1/transfers/confirm'))
        confirmation = request;
    });
    await sender.getByRole('button', { name: 'Confirm transfer' }).click();
    await expect(
      sender.getByRole('heading', { name: 'Prototype transfer record' }),
    ).toBeVisible();
    await expect(sender.getByText('COMPLETED', { exact: true })).toBeVisible();
    await expect(sender.getByText('LKR 100.00')).toBeVisible();
    await expect(sender.locator('body')).not.toContainText(
      /customerId|ledgerJournalId|idempotencyKeyHash|requestHash/u,
    );
    const transferId = new URL(sender.url()).pathname.split('/').pop()!;

    const captured = confirmation;
    if (!captured) throw new Error('Confirmation request was not captured.');
    const retry = await sender.evaluate(
      async ({ requestBody, key }) => {
        const csrf =
          document.cookie
            .split('; ')
            .find((item) => item.startsWith('aegis_csrf='))
            ?.split('=')[1] ?? '';
        const response = await fetch(
          'http://localhost:4000/api/v1/transfers/confirm',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': decodeURIComponent(csrf),
              'idempotency-key': key,
            },
            body: requestBody,
          },
        );
        return {
          status: response.status,
          body: (await response.json()) as { id: string },
        };
      },
      {
        requestBody: captured.postData()!,
        key: captured.headers()['idempotency-key']!,
      },
    );
    expect(retry).toEqual({
      status: 200,
      body: expect.objectContaining({ id: transferId }),
    });

    expect((await balance(sender, senderAccount.id)).balance.minorUnits).toBe(
      '90000',
    );
    expect(
      (await balance(recipient, recipientAccount.id)).balance.minorUnits,
    ).toBe('10000');
    await sender.goto(`/app/accounts/${senderAccount.id}`);
    await sender.getByLabel('Direction').selectOption('OUTGOING');
    await expect(sender.getByText('−LKR 100.00')).toBeVisible();
    await recipient.goto(`/app/accounts/${recipientAccount.id}`);
    await recipient.getByLabel('Direction').selectOption('INCOMING');
    await expect(recipient.getByText('+LKR 100.00')).toBeVisible();
    await sender.goto('/app/transfers');
    await expect(sender.getByText(/Sent · COMPLETED/u)).toHaveCount(1);
    await recipient.goto('/app/transfers');
    await expect(recipient.getByText(/Received · COMPLETED/u)).toHaveCount(1);

    await sender.goto('/app/transfers/new');
    await sender
      .getByLabel('Recipient AEGIS reference')
      .fill(senderAccount.reference);
    await sender.getByLabel('Amount (LKR)').fill('1.00');
    await sender.getByRole('button', { name: 'Preview transfer' }).click();
    await expect(sender.locator('.transfer-form [role="alert"]')).toBeVisible();
    await openPreview(sender, recipientAccount.reference, '10000.00');
    await sender.getByLabel('Enter your PIN').fill(pin);
    await sender.getByRole('button', { name: 'Confirm transfer' }).click();
    await expect(sender.locator('.transfer-form [role="alert"]')).toContainText(
      /could not be completed/u,
    );

    await openPreview(sender, recipientAccount.reference, '1.00');
    await expireLatestIntent(senderAccount.id);
    await sender.getByLabel('Enter your PIN').fill(pin);
    await sender.getByRole('button', { name: 'Confirm transfer' }).click();
    await expect(sender.locator('.transfer-form [role="alert"]')).toContainText(
      /preview expired/u,
    );

    await sender.setViewportSize({ width: 320, height: 800 });
    await sender.goto(`/app/transfers/${transferId}`);
    await expect(sender.locator('.receipt')).toBeVisible();
    await sender.setViewportSize({ width: 768, height: 900 });
    await expect(sender.locator('.receipt')).toBeVisible();
    await sender.setViewportSize({ width: 1440, height: 900 });
    await expect(sender.locator('.receipt')).toBeVisible();
    await sender.getByLabel('Interface language').selectOption('SI');
    await expect(
      sender.getByRole('heading', { name: 'මූලාකෘති හුවමාරු වාර්තාව' }),
    ).toBeVisible();
    await sender.getByLabel('අතුරුමුහුණත් භාෂාව').selectOption('TA');
    await expect(
      sender.getByRole('heading', { name: 'முன்மாதிரி பரிமாற்றப் பதிவு' }),
    ).toBeVisible();
    await sender.getByRole('button', { name: 'வெளியேறவும்' }).click();
    await expect(sender).toHaveURL(/\/sign-in$/u);
    await sender.goto('/app/transfers');
    await expect(sender).toHaveURL(/\/sign-in$/u);
  } finally {
    await Promise.allSettled([close(senderContext), close(recipientContext)]);
  }
});
