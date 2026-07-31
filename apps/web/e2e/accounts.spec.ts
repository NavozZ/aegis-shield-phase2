import { expect, test, type Page } from '@playwright/test';

const phone = '+12025550127';
const pin = '628413';

async function demoOtp(page: Page): Promise<string> {
  return (await page.locator('.demo-code').first().textContent())?.trim() || '';
}

/** Onboards the synthetic account-flow customer and lands on the workspace. */
async function authenticate(page: Page) {
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
}

test.describe
  .serial('@functional Tier-0 account provisioning browser journey', () => {
  test('creates one Tier-0 account, persists it across a reload and protects it after logout', async ({
    page,
  }) => {
    await authenticate(page);

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
      page.getByText('Transaction history comes in Prompt 06.'),
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

    // The full reference and internal identifiers never reach the page.
    await expect(page.locator('body')).not.toContainText(
      /AEGIS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/u,
    );

    // 6. Logging out and confirming the protected route redirects.
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in$/u);
    await expect(page.locator('body')).not.toContainText('LKR 0.00');
  });
});
