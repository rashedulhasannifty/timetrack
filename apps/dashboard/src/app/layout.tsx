import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Schibsted_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font — no runtime request to Google, and the
// CSS variables are what globals.css's --font-sans / --font-mono resolve to.
const schibsted = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-schibsted',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nifty Timer',
  description: 'Self-hosted time tracking and workforce analytics',
};

// Seed the .dark class and the data-density attribute before first paint so the manual
// theme/density choices (or, on first visit, the OS setting for theme) apply with no
// flash. Tiny + inline; the top-bar toggles write localStorage['tt-theme'] / ['tt-density'].
const THEME_INIT = `(function(){try{var t=localStorage.getItem('tt-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}var d=localStorage.getItem('tt-density');document.documentElement.setAttribute('data-density',d==='compact'?'compact':'comfortable')}catch(e){}})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${schibsted.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="bg-surface text-text min-h-screen antialiased">{children}</body>
    </html>
  );
}
