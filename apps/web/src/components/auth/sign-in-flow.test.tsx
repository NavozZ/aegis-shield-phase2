import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInFlow } from './sign-in-flow';
import { AuthClientError } from '@/lib/api/auth-client';
import { renderWithLanguage } from '@/test/render';

const mocks = vi.hoisted(() => ({
  supported: true,
  authenticate: vi.fn(),
  requestOtp: vi.fn(),
  login: vi.fn(),
  getSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/api/auth-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth-client')>(
    '@/lib/api/auth-client',
  );
  return {
    ...actual,
    authClient: {
      requestFallbackOtp: mocks.requestOtp,
      completeFallbackLogin: mocks.login,
      getSession: mocks.getSession,
    },
  };
});
vi.mock('@/lib/auth/passkeys', () => ({
  isPasskeySupported: () => mocks.supported,
  authenticateWithPasskey: mocks.authenticate,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supported = true;
  localStorage.clear();
  sessionStorage.clear();
});

describe('sign-in flow', () => {
  it('keeps fallback available when passkeys are unsupported', async () => {
    mocks.supported = false;
    renderWithLanguage(<SignInFlow />);
    expect(
      await screen.findByText(/not available in this browser/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Use phone, PIN and OTP' }),
    ).toBeEnabled();
  });

  it('handles passkey cancellation without credential detail', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new DOMException('cancelled', 'NotAllowedError'),
    );
    renderWithLanguage(<SignInFlow />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign in with passkey' }),
    );
    expect(
      await screen.findByText(/request was cancelled/u),
    ).toBeInTheDocument();
  });

  it('keeps fallback PIN in memory and completes OTP sign-in', async () => {
    mocks.requestOtp.mockResolvedValueOnce({
      accepted: true,
      challengeId: '550e8400-e29b-41d4-a716-446655440001',
      demoOtp: '482610',
    });
    mocks.login.mockResolvedValueOnce(session);
    mocks.getSession.mockResolvedValueOnce(session);
    renderWithLanguage(<SignInFlow />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Use phone, PIN and OTP' }),
    );
    await userEvent.type(
      screen.getByLabelText('Mobile number'),
      '+12025550123',
    );
    await userEvent.type(screen.getByLabelText('Six-digit PIN'), '739182');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue and request OTP' }),
    );
    await userEvent.type(
      await screen.findByLabelText('Six-digit verification code'),
      '482610',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Complete secure sign-in' }),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/app');
    expect(document.body).not.toHaveTextContent('739182');
  });

  it('keeps temporary lockout messaging generic', async () => {
    mocks.requestOtp.mockRejectedValueOnce(
      new AuthClientError('temporarily_locked', 401),
    );
    renderWithLanguage(<SignInFlow />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Use phone, PIN and OTP' }),
    );
    await userEvent.type(
      screen.getByLabelText('Mobile number'),
      '+12025550123',
    );
    await userEvent.type(screen.getByLabelText('Six-digit PIN'), '739182');
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue and request OTP' }),
    );
    expect(
      await screen.findByText(
        'Sign-in is temporarily unavailable. Please try again later.',
      ),
    ).toBeInTheDocument();
  });
});
