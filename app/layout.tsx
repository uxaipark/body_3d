import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import '../public/ui/select.css';
import '../public/ui/soma-theme.css';
import './page-design.css';
import {LanguageProvider} from './language';
import {getServerLanguage} from '../lib/i18n/server';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export async function generateMetadata(): Promise<Metadata> {
 const language=await getServerLanguage();return {
  title: language==='en'?'SOMA | Biosensing Digital Twin':'SOMA | 바이오센싱 디지털 트윈',
  icons: { icon: '/favicon.svg' },
  description: language==='en'?'A real-time biosignal laboratory for whole-body anatomy and virtual sensors':'전신 해부학과 가상 센서의 실시간 생체신호 실험실',
};}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language=await getServerLanguage();
  return (
    <html lang={language}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LanguageProvider language={language}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
