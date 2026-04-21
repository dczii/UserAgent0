import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'agents-kit',
  description: 'AI developer agents Kanban board',
};

const themeInit = `(function(){try{var t=localStorage.getItem('ua0-theme');if(t==='light')document.documentElement.classList.add('theme-light');}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
