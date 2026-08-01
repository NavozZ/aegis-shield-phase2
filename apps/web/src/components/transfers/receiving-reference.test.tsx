import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLanguage } from '@/test/render';
import { ReceivingReference } from './receiving-reference';
import { transferCopy } from './transfer-copy';

describe('ReceivingReference', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('copies the full receiving reference and announces feedback', async () => {
    renderWithLanguage(<ReceivingReference reference="AEGIS-ABCD-EFGH-JKLM" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy reference' }),
    );
    expect(writeText).toHaveBeenCalledWith('AEGIS-ABCD-EFGH-JKLM');
    expect(screen.getByText('Reference copied.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveFocus();
  });

  it.each(['EN', 'SI', 'TA'] as const)(
    'has complete localized copy in %s',
    (language) => {
      const englishKeys = Object.keys(transferCopy.EN).sort();
      expect(Object.keys(transferCopy[language]).sort()).toEqual(englishKeys);
      renderWithLanguage(
        <ReceivingReference reference="AEGIS-ABCD-EFGH-JKLM" />,
        language,
      );
      expect(
        screen.getByText(transferCopy[language].receiveMoney),
      ).toBeInTheDocument();
    },
  );
});
