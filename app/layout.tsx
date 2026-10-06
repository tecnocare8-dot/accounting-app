import type { Metadata, Viewport } from 'next';
import AppShell from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: '会計アプリ',
  description: '法人の帳簿を付け、決算書と申告に写す数字を作るアプリ。帳簿はGoogleドライブに保存',
  appleWebApp: { capable: true, title: '会計アプリ', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#285e4b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
