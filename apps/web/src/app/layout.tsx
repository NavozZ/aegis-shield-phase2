import type { Metadata, Viewport } from 'next';
import { LanguageProvider } from '@/lib/i18n/language-provider';
import { getServerLanguage } from '@/lib/i18n/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'AEGIS Shield | Secure authentication',
  description:
    'AEGIS Shield is a resilient, inclusive, zero-trust banking platform prototype for Duothan 6.0 Phase 2.',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  initialScale: 1,
  themeColor: '#07182f',
  width: 'device-width',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getServerLanguage();
  const htmlLanguage = { EN: 'en', SI: 'si', TA: 'ta' }[language];
  return (
    <html lang={htmlLanguage}>
      <body>
        <LanguageProvider initialLanguage={language}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
