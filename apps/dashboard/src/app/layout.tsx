import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="bg-surface text-text min-h-screen antialiased">{children}</body>
    </html>
  );
}
