'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi, get, money, dt, METHOD } from '@/lib/api';
import { Page, Card, Loading, Err, StatusBadge, Field } from '@/components/ui';
import { useMe } from '@/lib/me';
import { ReceiptModal } from '@/components/Receipt';

function Inner() {
  const me = useMe(); const sym = me.currency_symbol; const sp = useSearchParams();
  const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [pm, setPm] = useState('');
  const qs = new URLSearchParams({ q, limit: '100', ...(from && { from }), ...(to && { to }), ...(pm && { payment_method: pm }) }).toString();
  const list = useApi<any>(`/sales?${qs}`, { interval: 10000 });
  const [rc, setRc] = useState<any>(null);
  async function open(id: string) { const r = await get(`/sales/${id}/receipt`); setRc({ ...r.receipt, sale_id: id }); }
  useEffect(() => { const o = sp.get('open'); if (o) open(o).catch(() => {}); }, []);
  const all = me.permissions.includes('sales.view_all');
  const total = (list.data?.sales || []).reduce((s: number, x: any) => s + x.total - x.refunded_total, 0);
  return (<Page title="Sales" sub={all ? 'All transactions' : 'Your transactions'}>
    <Card><div className="grid g4">
      <Field label="Receipt / customer"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="RCP-000012" /></Field>
      <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Payment"><select value={pm} onChange={(e) => setPm(e.target.value)}><option value="">All</option>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
    </div></Card>
    <div style={{ height: 14 }} />
    <Card>{list.loading && !list.data ? <Loading /> : <><Err msg={list.error} />
      <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th>{all && <th>Employee</th>}<th>Payment</th><th className="num">Units</th><th className="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
        {list.data?.sales.map((s: any) => <tr key={s.id}><td><b>{s.receipt_no}</b>{s.customer_name && <div className="small muted">{s.customer_name}</div>}</td><td className="small">{dt(s.created_at)}</td>{all && <td>{s.employee_name}</td>}<td>{METHOD[s.payment_method]}</td><td className="num">{s.units}</td>
          <td className="num"><b>{money(s.total, sym)}</b>{s.balance_due > 0 && <div className="small" style={{ color: 'var(--warn)' }}>owes {money(s.balance_due, sym)}</div>}</td><td><StatusBadge status={s.status} /></td><td><button className="btn secondary sm" onClick={() => open(s.id)}>Receipt</button></td></tr>)}
        {list.data?.sales.length === 0 && <tr><td colSpan={8} className="empty">No sales found</td></tr>}
      </tbody></table></div>
      <div className="small muted" style={{ marginTop: 8 }}>Showing {list.data?.sales.length} sale(s) · net of refunds {money(total, sym)}</div></>}</Card>
    {rc && <ReceiptModal r={rc} sym={sym} onClose={() => setRc(null)} />}
  </Page>);
}
export default function Sales() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
