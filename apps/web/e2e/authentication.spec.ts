import { expect, test, type Page } from '@playwright/test';
import { dictionaries } from '../src/lib/i18n/dictionaries';

const phone = '+12025550123';
const passkeyPhone = '+12025550125';
const pin = '739182';

async function demoOtp(page: Page): Promise<string> {
  return (await page.locator('.demo-code').first().textContent())?.trim() || '';
}

async function reachPasskeyStep(page: Page, mobileNumber: string) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create secure access' }).click();
  await page.getByLabel('Mobile number').fill(mobileNumber);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request verification code' }).click();
  await expect(
    page.getByRole('heading', { name: 'OTP verification' }),
  ).toBeFocused();
  await page
    .getByLabel('Six-digit verification code')
    .fill(await demoOtp(page));
  await page.getByRole('button', { name: 'Verify code' }).click();
  await page.getByLabel('Six-digit PIN', { exact: true }).fill(pin);
  await page.getByLabel('Confirm six-digit PIN').fill(pin);
  await page
    .getByRole('button', { name: 'Create PIN and secure session' })
    .click();
  await expect(page.getByRole('heading', { name: 'Passkey' })).toBeVisible();
}

async function onboarding(page: Page) {
  await reachPasskeyStep(page, phone);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByText('Secure access created')).toBeVisible();
  await page
    .getByRole('button', { name: 'Continue to secure workspace' })
    .click();
  await expect(page).toHaveURL(/\/app$/u);
}

async function fallbackSignIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use phone, PIN and OTP' }).click();
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Six-digit PIN', { exact: true }).fill(pin);
  await page.getByRole('button', { name: 'Continue and request OTP' }).click();
  await page
    .getByLabel('Six-digit verification code')
    .fill(await demoOtp(page));
  await page.getByRole('button', { name: 'Complete secure sign-in' }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
}

test.describe
  .serial('@functional secure authentication browser journeys', () => {
  test('completes onboarding, restores the session, logs out and protects routes', async ({
    page,
  }) => {
    await onboarding(page);
    await expect(
      page.getByRole('heading', { name: 'Secure workspace' }),
    ).toBeVisible();
    await expect(page.getByText(/\+\d{1,3}\*+123/u)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(phone);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Secure workspace' }),
    ).toBeVisible();
    await logout(page);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in$/u);
  });

  test('completes phone, PIN and OTP fallback sign-in', async ({ page }) => {
    await fallbackSignIn(page);
    await expect(page.getByText('PIN and OTP')).toBeVisible();
    await logout(page);
  });

  test('registers and authenticates a real virtual passkey ceremony', async ({
    page,
    context,
  }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await reachPasskeyStep(page, passkeyPhone);
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page
      .getByRole('button', { name: 'Continue to secure workspace' })
      .click();
    await expect(page).toHaveURL(/\/app$/u);
    await page.goto('/app/security');
    await page.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByText('Passkey added successfully.')).toBeVisible();
    await logout(page);
    await page.getByRole('button', { name: 'Sign in with passkey' }).click();
    await expect(page).toHaveURL(/\/app$/u);
    await expect(
      page.getByText('Passkey', { exact: true }).first(),
    ).toBeVisible();
    await logout(page);
  });

  test('handles validation, keyboard, unavailable service and responsive viewports', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto('/onboarding');
    const languageSelector = page.locator('.topbar select');
    await languageSelector.selectOption('SI');
    await expect(page.locator('html')).toHaveAttribute('lang', 'si');
    await expect(
      page.getByRole('heading', { name: dictionaries.SI.onboardingTitle }),
    ).toBeVisible();
    await languageSelector.selectOption('TA');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    await expect(
      page.getByRole('heading', { name: dictionaries.TA.onboardingTitle }),
    ).toBeVisible();
    await languageSelector.selectOption('EN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByLabel('Mobile number').fill('0771234567');
    await page
      .getByRole('button', { name: 'Request verification code' })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Consent is required' }),
    ).toBeVisible();
    await page.getByRole('checkbox').check();
    await page
      .getByRole('button', { name: 'Request verification code' })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'valid E.164' }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sign-in');
    await page.route('http://localhost:4000/**', (route) => route.abort());
    await page.getByRole('button', { name: 'Sign in with passkey' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: /network is unavailable/u }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
