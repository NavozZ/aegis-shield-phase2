'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { dictionaries, type Dictionary, type Language } from './dictionaries';

const htmlLanguages: Record<Language, string> = {
  EN: 'en',
  SI: 'si',
  TA: 'ta',
};
interface LanguageContextValue {
  language: Language;
  dictionary: Dictionary;
  setLanguage: (language: Language) => void;
}
const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: React.ReactNode;
}) {
  const [language, updateLanguage] = useState(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = htmlLanguages[language];
  }, [language]);
  const setLanguage = useCallback((nextLanguage: Language) => {
    updateLanguage(nextLanguage);
    document.cookie = `aegis_language=${nextLanguage}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);
  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      dictionary: dictionaries[language],
      setLanguage,
    }),
    [language, setLanguage],
  );
  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value)
    throw new Error('useLanguage must be used within LanguageProvider.');
  return value;
}
