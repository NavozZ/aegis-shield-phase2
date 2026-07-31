import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageSelector } from '@/components/layout/language-selector';
import { dictionaries } from './dictionaries';
import { renderWithLanguage } from '@/test/render';

describe('translation dictionaries', () => {
  it('keeps EN, SI and TA dictionaries complete', () => {
    const englishKeys = Object.keys(dictionaries.EN).sort();
    expect(Object.keys(dictionaries.SI).sort()).toEqual(englishKeys);
    expect(Object.keys(dictionaries.TA).sort()).toEqual(englishKeys);
    expect(englishKeys.length).toBeGreaterThan(80);
  });

  it('updates the selected interface language and document lang', () => {
    renderWithLanguage(<LanguageSelector />);
    fireEvent.change(screen.getByLabelText(dictionaries.EN.chooseLanguage), {
      target: { value: 'TA' },
    });
    expect(document.documentElement.lang).toBe('ta');
    expect(screen.getByLabelText(dictionaries.TA.chooseLanguage)).toHaveValue(
      'TA',
    );
  });
});
