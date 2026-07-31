import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingFlow } from './onboarding-flow';
import { AuthClientError } from '@/lib/api/auth-client';
import { renderWithLanguage } from '@/test/render';

const mocks = vi.hoisted(() => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  createPin: vi.fn(),
  getSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  register: vi.fn(),
}));
vi.mock('@/lib/api/auth-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth-client')>(
    '@/lib/api/auth-client',
  );
  return {
    ...actual,
    authClient: {
      requestOnboardingOtp: mocks.requestOtp,
      verifyOnboardingOtp: mocks.verifyOtp,
      createPin: mocks.createPin,
      getSession: mocks.getSession,
    },
  };
});
vi.mock('@/lib/auth/passkeys', () => ({
  registerPasskey: mocks.register,
  isPasskeySupported: () => true,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

const session = {
  authenticated: true as const,
  authenticationMethod: 'PIN_OTP' as const,
  expiresAt: '2026-08-01T12:00:00.000Z',
  user: {
    id: '550e8400-e29b-41d4-a716-446655440002',
    phoneMasked: '+1******123',
    preferredLanguage: 'EN' as const,
    kycTier: 0,
    status: 'ACTIVE' as const,
    phoneVerified: true,
  },
};

async function reachOtp(demoOtp?: string) {
  mocks.requestOtp.mockResolvedValueOnce({
    accepted: true,
    challengeId: '550e8400-e29b-41d4-a716-446655440001',
    ...(demoOtp ? { demoOtp } : {}),
  });
  await userEvent.type(screen.getByLabelText('Mobile number'), '+12025550123');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(
    screen.getByRole('button', { name: 'Request verification code' }),
  );
  await screen.findByRole('heading', { name: 'OTP verification' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('onboarding flow', () => {
  it('requires consent and rejects invalid E.164 input', async () => {
    renderWithLanguage(<OnboardingFlow />);
    await userEvent.type(screen.getByLabelText('Mobile number'), '0771234567');
    await userEvent.click(
      screen.getByRole('button', { name: 'Request verification code' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Consent is required to continue.',
    );
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Request verification code' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid E.164 mobile number.',
    );
    expect(mocks.requestOtp).not.toHaveBeenCalled();
  });

  it('shows demo OTP only when explicitly returned', async () => {
    renderWithLanguage(<OnboardingFlow />);
    await reachOtp('482610');
    expect(screen.getByText('482610')).toBeInTheDocument();
  });

  it('does not assume or render a missing demo OTP', async () => {
    renderWithLanguage(<OnboardingFlow />);
    await reachOtp();
    expect(
      screen.queryByText('Local demonstration OTP'),
    ).not.toBeInTheDocument();
  });

  it('cannot enter OTP state without an accepted in-memory challenge', () => {
    renderWithLanguage(<OnboardingFlow />);
    expect(
      screen.queryByLabelText('Six-digit verification code'),
    ).not.toBeInTheDocument();
  });

  it('keeps enrollment credentials out of rendering and browser storage', async () => {
    renderWithLanguage(<OnboardingFlow />);
    await reachOtp();
    mocks.verifyOtp.mockResolvedValueOnce({
      enrollmentToken: 'sensitive-enrollment-token-value-123456',
      expiresInSeconds: 600,
      user: session.user,
    });
    await userEvent.type(
      screen.getByLabelText('Six-digit verification code'),
      '482610',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    await screen.findByRole('heading', { name: 'Secure PIN' });
    expect(document.body).not.toHaveTextContent(
      'sensitive-enrollment-token-value-123456',
    );
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain('sensitive-enrollment');
  });

  it('shows a generic incorrect OTP error', async () => {
    renderWithLanguage(<OnboardingFlow />);
    await reachOtp();
    mocks.verifyOtp.mockRejectedValueOnce(
      new AuthClientError('invalid_otp', 401),
    );
    await userEvent.type(
      screen.getByLabelText('Six-digit verification code'),
      '000000',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /invalid or expired/u,
    );
  });

  it('rejects weak PINs and clears successful PIN state', async () => {
    renderWithLanguage(<OnboardingFlow />);
    await reachOtp();
    mocks.verifyOtp.mockResolvedValueOnce({
      enrollmentToken: 'a'.repeat(32),
      expiresInSeconds: 600,
      user: session.user,
    });
    await userEvent.type(
      screen.getByLabelText('Six-digit verification code'),
      '482610',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    await screen.findByRole('heading', { name: 'Secure PIN' });
    await userEvent.type(screen.getByLabelText('Six-digit PIN'), '123456');
    await userEvent.type(
      screen.getByLabelText('Confirm six-digit PIN'),
      '123456',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create PIN and secure session' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a less predictable six-digit PIN.',
    );
    fireEvent.change(screen.getByLabelText('Six-digit PIN'), {
      target: { value: '739182' },
    });
    fireEvent.change(screen.getByLabelText('Confirm six-digit PIN'), {
      target: { value: '739182' },
    });
    mocks.createPin.mockResolvedValueOnce(session);
    mocks.getSession.mockResolvedValueOnce(session);
    await userEvent.click(
      screen.getByRole('button', { name: 'Create PIN and secure session' }),
    );
    await waitFor(() =>
      expect(screen.queryByDisplayValue('739182')).not.toBeInTheDocument(),
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
