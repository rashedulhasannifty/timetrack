import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

// Self-hosted by next/font at build time — no runtime request to fonts.googleapis.com,
// and no layout shift. The variables are consumed by --font-sans / --font-mono in globals.css.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nifty Timer',
  description: 'Self-hosted time tracking and workforce analytics',
};

// Seed the .dark class before first paint so the manual theme choice (or, on first
// visit, the OS setting) applies with no flash. Tiny + inline; the top-bar toggle
// writes localStorage['tt-theme'].
const THEME_INIT = `(function(){try{var t=localStorage.getItem('tt-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="bg-surface text-text min-h-screen antialiased">{children}</body>
    </html>
  );
}
