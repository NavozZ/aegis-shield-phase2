import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLanguage } from '@/test/render';
import { AuthenticatedShell } from './authenticated-shell';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/api/auth-client', () => ({
  authClient: { logout: mocks.logout },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

const session = {
  authenticated: true as const,
  authenticationMethod: 'PASSKEY' as const,
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
});

describe('authenticated shell', () => {
  it('revokes the session and replaces browser history on logout', async () => {
    mocks.logout.mockResolvedValueOnce({ revoked: true });
    renderWithLanguage(
      <AuthenticatedShell session={session}>
        <p>Safe protected content</p>
      </AuthenticatedShell>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith('/sign-in');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
