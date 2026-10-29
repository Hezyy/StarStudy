import type { Metadata, Viewport } from 'next';
import { appUrl } from '@/lib/app-path';
import { Provider } from '@/components/provider';
import { Shell } from '@/components/shell';
import { TimerDock } from '@/features/tasks/timer-dock';
import { PlatformGate } from '@/features/platform/platform';
import { OnboardingGate } from '@/features/platform/onboarding';
import './globals.css';
import './learning.css';
import './experience.css';
import './platform.css';
export const metadata: Metadata = {
  title: { default: '星研 · 今日学习', template: '%s · 星研' },
  description: '星研，个人考研学习管理助手。以星为引，逐梦研途。',
  applicationName: '星研',
  manifest: appUrl('/manifest.webmanifest'),
  icons: {
    icon: [
      { url: appUrl('/favicon.ico') },
      { url: appUrl('/icons/star.svg'), type: 'image/svg+xml' },
    ],
    apple: appUrl('/icons/apple-touch-icon.png'),
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '星研' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#172b50',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <PlatformGate>
          <Provider>
            <OnboardingGate>
              <Shell>{children}</Shell>
            </OnboardingGate>
            <TimerDock />
          </Provider>
        </PlatformGate>
      </body>
    </html>
  );
}
