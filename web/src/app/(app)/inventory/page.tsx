'use client';
import { useState } from 'react';
import { useApi, dt } from '@/lib/api';
import { Page, Card, Loading, Field } from '@/components/ui';

const TYPE: any = { initial: ['b-blue', 'New product'], sale: ['b-grey', 'Sold'], restock: ['b-ok', 'Restocked'], removed: ['b-bad', 'Removed'], damaged: ['b-bad', 'Damaged'], missing: ['b-bad', 'Missing'], return: ['b-ok', 'Returned'], manual_add: ['b-warn', 'Adjusted +'], manual_remove: ['b-warn', 'Adjusted −'], sale_void: ['b-grey', 'Void'] };

export default function History() {
  const [q, setQ] = useState(''); const [type, setType] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const qs = new URLSearchParams({ q, limit: '200', ...(type && { type }), ...(from && { from }), ...(to && { to }) }).toString();
  const list = useApi<any>(`/inventory/movements?${qs}`, { interval: 10000 });
  return (<Page title="Stock movement history" sub="Every change to stock, who made it and why.">
    <Card><div className="grid g4"><Field label="Product"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{Object.entries(TYPE).map(([k, v]: any) => <option key={k} value={k}>{v[1]}</option>)}</select></Field>
      <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div></Card>
    <div style={{ height: 14 }} />
    <Card>{list.loading && !list.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Before</th><th className="num">Change</th><th className="num">After</th><th>By</th><th>Reason</th></tr></thead><tbody>
      {list.data?.movements.map((m: any) => <tr key={m.id}><td className="small nowrap">{dt(m.created_at)}</td><td>{m.product_name}</td><td><span className={`badge ${TYPE[m.type]?.[0]}`}>{TYPE[m.type]?.[1] || m.type}</span></td>
        <td className="num">{m.qty_before}</td><td className="num" style={{ color: m.qty_change > 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 700 }}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</td><td className="num"><b>{m.qty_after}</b></td><td>{m.user_name || '—'}</td><td className="small">{m.reason}</td></tr>)}
      {list.data?.movements.length === 0 && <tr><td colSpan={8} className="empty">No stock movements found</td></tr>}</tbody></table></div>}</Card>
  </Page>);
}
