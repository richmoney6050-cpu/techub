import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = { title: 'TECHHUB — Tech Shop Management', description: 'Inventory, sales and business management for tech shops' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b1220' };

const THEME_BOOT = `try{var p=localStorage.getItem('techhub-theme')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head><body><ToastProvider>{children}</ToastProvider></body></html>);
}
