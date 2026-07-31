import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { LanguageProvider } from '@/lib/i18n/language-provider';

export function renderWithLanguage(
  element: ReactElement,
  language: 'EN' | 'SI' | 'TA' = 'EN',
) {
  return render(
    <LanguageProvider initialLanguage={language}>{element}</LanguageProvider>,
  );
}
