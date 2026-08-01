'use client';

import { useLanguage } from '@/lib/i18n/language-provider';

export function PrintRecordButton() {
  const { dictionary } = useLanguage();
  return (
    <button
      className="button button-secondary no-print"
      onClick={() => window.print()}
    >
      {dictionary.print}
    </button>
  );
}
