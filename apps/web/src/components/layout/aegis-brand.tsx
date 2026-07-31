'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/language-provider';

export function AegisBrand({ compact = false }: { compact?: boolean }) {
  const { dictionary } = useLanguage();
  return (
    <Link href="/" className="brand" aria-label={dictionary.brandHome}>
      <svg className="brand-mark" viewBox="0 0 48 54" aria-hidden="true">
        <path
          d="M24 2 44 9v15c0 13-8 23-20 28C12 47 4 37 4 24V9L24 2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          d="m14 29 7 7 14-17"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path
          d="M12 12 24 8l12 4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          opacity=".55"
        />
      </svg>
      <span>
        <strong>AEGIS SHIELD</strong>
        {!compact && <small>DUOTHAN 6.0</small>}
      </span>
    </Link>
  );
}
