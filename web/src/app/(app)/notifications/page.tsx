'use client';
import { useApi, post, dt } from '@/lib/api';
import { Page, Card, Loading } from '@/components/ui';

const ICON: any = { low_stock: ['b-warn', '⚠ LOW'], out_of_stock: ['b-bad', '⛔ OUT'], restocked: ['b-ok', '✔ BACK'], system: ['b-blue', 'INFO'] };
export default function Notifications() {
  const n = useApi<any>('/notifications', { interval: 8000 });
  return (<Page title="Notifications" sub="Low-stock, out-of-stock and restock alerts" actions={<button className="btn secondary" onClick={async () => { await post('/notifications/read-all'); n.reload(); }}>Mark all as read</button>}>
    <Card>{n.loading && !n.data ? <Loading /> : <>{n.data?.notifications.map((x: any) => <div key={x.id} className="row" style={{ padding: '12px 0', borderBottom: '1px solid #eef1f6', opacity: x.resolved ? 0.6 : 1, flexWrap: 'nowrap' }}>
      <span className={`badge ${ICON[x.type][0]}`} style={{ minWidth: 72, textAlign: 'center' }}>{ICON[x.type][1]}</span><div className="grow"><b style={{ fontWeight: x.is_read ? 400 : 700 }}>{x.message}</b><div className="small muted">{dt(x.created_at)}{x.resolved ? ' · resolved' : ''}</div></div>
      {!x.is_read && <button className="btn ghost sm" onClick={async () => { await post(`/notifications/${x.id}/read`); n.reload(); }}>Mark read</button>}</div>)}
      {n.data?.notifications.length === 0 && <div className="empty">No notifications yet. You'll be alerted here when stock runs low.</div>}</>}</Card>
  </Page>);
}
