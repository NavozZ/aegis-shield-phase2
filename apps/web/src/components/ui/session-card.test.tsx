import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dictionaries } from '@/lib/i18n/dictionaries';
import { renderWithLanguage } from '@/test/render';
import { SessionCard } from './session-card';

describe('safe session rendering', () => {
  it('renders only masked authenticated user data', () => {
    renderWithLanguage(
      <SessionCard
        dictionary={dictionaries.EN}
        session={{
          authenticated: true,
          authenticationMethod: 'PASSKEY',
          expiresAt: '2026-08-01T12:00:00.000Z',
          user: {
            id: '550e8400-e29b-41d4-a716-446655440002',
            phoneMasked: '+1******123',
            preferredLanguage: 'EN',
            kycTier: 0,
            status: 'ACTIVE',
            phoneVerified: true,
          },
        }}
      />,
    );
    expect(screen.getByText('+1******123')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('aegis_session');
    expect(document.body).not.toHaveTextContent('aegis_csrf');
  });
});
