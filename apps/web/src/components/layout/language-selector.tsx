'use client';

import { languages, type Language } from '@/lib/i18n/dictionaries';
import { useLanguage } from '@/lib/i18n/language-provider';

const labels: Record<Language, string> = {
  EN: 'English',
  SI: 'සිංහල',
  TA: 'தமிழ்',
};

export function LanguageSelector() {
  const { language, dictionary, setLanguage } = useLanguage();
  return (
    <label className="language-selector">
      <span className="sr-only">{dictionary.chooseLanguage}</span>
      <select
        aria-label={dictionary.chooseLanguage}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
      >
        {languages.map((code) => (
          <option key={code} value={code}>
            {labels[code]} · {code}
          </option>
        ))}
      </select>
    </label>
  );
}
