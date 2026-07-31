import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  await expectAccessible(page, 'protected application page');
  await page.goto('/app/security');
  await expectAccessible(page, 'security settings page');
});
