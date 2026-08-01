import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictionaries } from '@/lib/i18n/dictionaries';
import { renderWithLanguage } from '@/test/render';
import { PrintRecordButton } from './print-record-button';

afterEach(() => vi.restoreAllMocks());

describe('PrintRecordButton', () => {
  it('has an accessible name and invokes the browser print action', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderWithLanguage(<PrintRecordButton />);
    await userEvent.click(
      screen.getByRole('button', { name: dictionaries.EN.print }),
    );
    expect(print).toHaveBeenCalledTimes(1);
  });

  it.each(['SI', 'TA'] as const)(
    'translates its accessible name in %s',
    (language) => {
      renderWithLanguage(<PrintRecordButton />, language);
      expect(
        screen.getByRole('button', { name: dictionaries[language].print }),
      ).toBeInTheDocument();
    },
  );
});
