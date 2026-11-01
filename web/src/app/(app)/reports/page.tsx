'use client';
import { useState } from 'react';
import { useApi, money } from '@/lib/api';
import { Page, Card, Loading, Err, Field, Stat } from '@/components/ui';
import { useMe } from '@/lib/me';

const REPORTS: [string, string, boolean][] = [
  ['sales-daily', 'Daily sales', true], ['sales-weekly', 'Weekly sales', true], ['sales-monthly', 'Monthly sales', true], ['sales-annual', 'Annual sales', true],
  ['products', 'Product sales', true], ['employees', 'Employee sales', true], ['gross-profit', 'Gross profit', true], ['inventory', 'Inventory', false], ['low-stock', 'Low stock', false], ['expenses', 'Expenses', true],
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Reports() {
  const sym = useMe().currency_symbol;
  const today = new Date(); const [name, setName] = useState('sales-daily');
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1))); const [to, setTo] = useState(iso(today));
  const dated = REPORTS.find((r) => r[0] === name)![2];
  const qs = `from=${from}&to=${to}`;
  const r = useApi<any>(`/reports/${name}?${qs}`);
  const fmt = (v: any, t?: string) => (t === 'money' ? money(v, sym) : v ?? '');
  const preset = (k: string) => { const t = new Date(); if (k === 'today') { setFrom(iso(t)); setTo(iso(t)); } if (k === 'week') { const s = new Date(t); s.setDate(t.getDate() - 6); setFrom(iso(s)); setTo(iso(t)); } if (k === 'month') { setFrom(iso(new Date(t.getFullYear(), t.getMonth(), 1))); setTo(iso(t)); } if (k === 'year') { setFrom(`${t.getFullYear()}-01-01`); setTo(iso(t)); } };
  return (<Page title="Reports" sub="Revenue = sales less refunds · Gross profit = revenue − cost of goods · Net profit = gross profit − expenses">
    <Card><div className="grid g3"><Field label="Report"><select value={name} onChange={(e) => setName(e.target.value)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {dated && <><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}</div>
      <div className="row">{dated && (['today', 'week', 'month', 'year'] as const).map((k) => <button key={k} className="btn secondary sm" onClick={() => preset(k)}>{k === 'today' ? 'Today' : k === 'week' ? 'Last 7 days' : k === 'month' ? 'This month' : 'This year'}</button>)}
        <span style={{ flex: 1 }} /><a className="btn secondary" href={`/api/reports/${name}?${qs}&format=xlsx`}>⬇ Excel</a><a className="btn secondary" href={`/api/reports/${name}?${qs}&format=pdf`} target="_blank" rel="noreferrer">⬇ PDF</a></div></Card>
    <div style={{ height: 14 }} />
    {r.loading && !r.data ? <Loading /> : r.error ? <Err msg={r.error} /> : r.data && <>
      <div className="grid g4">{r.data.summary.map((s: any) => <Stat key={s.label} label={s.label} value={fmt(s.value, s.type)} />)}</div>
      <Card style={{ marginTop: 14 }}><h2>{r.data.title}</h2><div className="table-wrap"><table><thead><tr>{r.data.columns.map((c: any) => <th key={c.key} className={c.type === 'money' || c.type === 'int' ? 'num' : ''}>{c.label}</th>)}</tr></thead><tbody>
        {r.data.rows.map((row: any, i: number) => <tr key={i}>{r.data.columns.map((c: any) => <td key={c.key} className={c.type === 'money' || c.type === 'int' ? 'num' : ''}>{fmt(row[c.key], c.type)}</td>)}</tr>)}
        {r.data.rows.length === 0 && <tr><td colSpan={r.data.columns.length} className="empty">No data for this period</td></tr>}</tbody></table></div></Card></>}
  </Page>);
}
