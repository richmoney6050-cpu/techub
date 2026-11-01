import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = { title: 'TECHHUB — Tech Shop Management', description: 'Inventory, sales and business management for tech shops' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b1f3a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><ToastProvider>{children}</ToastProvider></body></html>);
}
