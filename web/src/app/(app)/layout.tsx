'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { get, post, useApi } from '@/lib/api';
import { Me, MeContext } from '@/lib/me';
import { Loading } from '@/components/ui';
import ThemeSwitch from '@/components/ThemeSwitch';

const NAV: { href: string; label: string; icon: string; perm?: string[]; owner?: boolean }[] = [
  { href: '/', label: 'Dashboard', icon: '▦' },
  { href: '/pos', label: 'Point of Sale', icon: '🛒', perm: ['sales.create'] },
  { href: '/products', label: 'Products & Stock', icon: '📦', perm: ['products.view', 'products.create', 'products.edit'] },
  { href: '/sales', label: 'Sales', icon: '🧾', perm: ['sales.view', 'sales.view_all'] },
  { href: '/returns', label: 'Returns', icon: '↩', perm: ['returns.process'] },
  { href: '/inventory', label: 'Stock History', icon: '📈', perm: ['stock.adjust', 'reports.view'] },
  { href: '/customers', label: 'Customers', icon: '🧑', perm: ['customers.manage'] },
  { href: '/warranties', label: 'Warranties', icon: '🛡', perm: ['warranty.manage'] },
  { href: '/suppliers', label: 'Suppliers', icon: '🚚', perm: ['suppliers.manage'] },
  { href: '/expenses', label: 'Expenses', icon: '💸', perm: ['expenses.manage', 'reports.view'] },
  { href: '/reports', label: 'Reports', icon: '📊', perm: ['reports.view'] },
  { href: '/employees', label: 'Employees', icon: '👥', owner: true },
  { href: '/notifications', label: 'Notifications', icon: '🔔', perm: ['notifications.view'] },
  { href: '/settings', label: 'Settings', icon: '⚙', owner: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { get('/auth/me').then((r) => setMe(r.user)).catch(() => (window.location.href = '/login')); }, []);
  useEffect(() => setOpen(false), [path]);
  const canNotif = !!me && me.permissions.includes('notifications.view');
  const notif = useApi<any>(canNotif ? '/notifications?unread=true' : null, { interval: 10000 });
  if (!me) return <Loading />;
  const visible = NAV.filter((n) => (n.owner ? me.role === 'owner' : !n.perm || n.perm.some((p) => me.permissions.includes(p))));
  const unread = notif.data?.unread_count || 0;
  async function logout() { await post('/auth/logout').catch(() => {}); window.location.href = '/login'; }
  return (<MeContext.Provider value={me}><div className="shell">
    {open && <div className="scrim" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><span className="dot">T</span>TECHHUB</div>
      <div className="biz">{me.business_name}</div>
      <nav className="nav" aria-label="Main">
        {visible.map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          return <Link key={n.href} href={n.href} className={active ? 'active' : ''}><span aria-hidden>{n.icon}</span>{n.label}{n.href === '/notifications' && unread > 0 && <span className="badge">{unread}</span>}</Link>;
        })}
      </nav>
      <div className="side-foot"><ThemeSwitch initial={me.theme} /><div style={{ color: '#fff', fontWeight: 600 }}>{me.name}</div><div style={{ marginBottom: 6 }}>{me.role === 'owner' ? 'Business owner' : 'Employee'}</div><button onClick={logout}>Sign out</button></div>
    </aside>
    <div className="main">
      <div className="topbar"><button onClick={() => setOpen(true)} aria-label="Open menu">☰</button><b>TECHHUB</b>{unread > 0 && <span className="badge b-bad" style={{ marginLeft: 'auto' }}>🔔 {unread}</span>}</div>
      <div className="content">{children}</div>
    </div>
  </div></MeContext.Provider>);
}
