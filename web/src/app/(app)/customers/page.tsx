'use client';
import { useState } from 'react';
import { useApi, get, post, put, del, money, uuid } from '@/lib/api';
import { Page, Card, Loading, Err, Field, Modal, AsyncButton, Stat, useToast } from '@/components/ui';
import { useMe } from '@/lib/me';

const METHODS = [['cash', 'Cash'], ['momo', 'MoMo'], ['bank_transfer', 'Bank'], ['card', 'Card']];

export default function Customers() {
  const me = useMe(); const sym = me.currency_symbol; const toast = useToast(); const canCredit = me.permissions.includes('customers.credit');
  const [q, setQ] = useState(''); const [owing, setOwing] = useState(false);
  const list = useApi<any>(`/customers?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}${owing ? '&owing=true' : ''}`);
  const [edit, setEdit] = useState<any | null>(null); const [view, setView] = useState<string | null>(null);
  const totalOwed = (list.data?.customers || []).reduce((s: number, c: any) => s + c.outstanding, 0);
  return (<Page title="Customers" sub="Purchase history, credit and outstanding balances" actions={<button className="btn" onClick={() => setEdit({})}>+ New customer</button>}>
    <div className="grid g3"><Stat label="Customers shown" value={list.data?.customers.length ?? '…'} /><Stat label="Outstanding (shown)" value={money(totalOwed, sym)} accent /></div>
    <div style={{ height: 14 }} />
    <Card><div className="row" style={{ marginBottom: 10 }}><input placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /><label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={owing} onChange={(e) => setOwing(e.target.checked)} />Owing only</label></div>
      {list.loading && !list.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th className="num">Purchases</th><th className="num">Total spent</th><th className="num">Owes</th><th></th></tr></thead><tbody>
        {list.data?.customers.map((c: any) => <tr key={c.id}><td><b>{c.name}</b></td><td>{c.phone || '—'}</td><td className="num">{c.purchases}</td><td className="num">{money(c.total_spent, sym)}</td><td className="num">{c.outstanding > 0 ? <span className="badge b-warn">{money(c.outstanding, sym)}</span> : '—'}</td><td className="right"><button className="btn secondary sm" onClick={() => setView(c.id)}>Open</button></td></tr>)}
        {list.data?.customers.length === 0 && <tr><td colSpan={6} className="empty">No customers found</td></tr>}</tbody></table></div>}</Card>
    {edit && <CustomerForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); toast('Customer saved'); }} />}
    {view && <CustomerDetail id={view} sym={sym} canCredit={canCredit} onClose={() => { setView(null); list.reload(); }} onEdit={(c: any) => { setView(null); setEdit(c); }} />}
  </Page>);
}

function CustomerForm({ initial, onClose, onSaved }: any) {
  const [f, setF] = useState({ name: initial.name || '', phone: initial.phone || '', email: initial.email || '', address: initial.address || '', notes: initial.notes || '' }); const [err, setErr] = useState<string | null>(null);
  async function save() { setErr(null); try { initial.id ? await put(`/customers/${initial.id}`, f) : await post('/customers', f); onSaved(); } catch (e: any) { setErr(e.message); } }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (<Modal title={initial.id ? 'Edit customer' : 'New customer'} onClose={onClose}><Err msg={err} />
    <Field label="Name"><input value={f.name} onChange={set('name')} /></Field><div className="grid g2"><Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field><Field label="Email"><input value={f.email} onChange={set('email')} /></Field></div>
    <Field label="Address"><input value={f.address} onChange={set('address')} /></Field><Field label="Notes"><textarea value={f.notes} onChange={set('notes')} /></Field>
    <AsyncButton onClick={save} disabled={f.name.trim().length < 2}>Save</AsyncButton></Modal>);
}

function CustomerDetail({ id, sym, canCredit, onClose, onEdit }: any) {
  const d = useApi<any>(`/customers/${id}`); const toast = useToast();
  const [pay, setPay] = useState<any | null>(null); const [amount, setAmount] = useState(''); const [method, setMethod] = useState('cash'); const [ref, setRef] = useState(''); const [key, setKey] = useState(uuid()); const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setErr(null);
    try { await post(`/customers/${id}/payments`, { idempotency_key: key, sale_id: pay.id, amount: Number(amount), method, reference: ref || undefined }); toast('Payment recorded'); setPay(null); setAmount(''); setRef(''); setKey(uuid()); d.reload(); }
    catch (e: any) { setErr(e.message); }
  }
  async function archive() { if (!confirm('Archive this customer? History is kept.')) return; try { await del(`/customers/${id}`); onClose(); } catch (e: any) { toast(e.message, 'err'); } }
  const c = d.data;
  return (<Modal title={c?.customer.name || 'Customer'} onClose={onClose} wide>{!c ? <Loading /> : <>
    <div className="grid g3"><Stat label="Total spent" value={money(c.totals.total_spent, sym)} /><Stat label="Outstanding" value={money(c.totals.outstanding, sym)} accent /><Stat label="Purchases" value={c.totals.purchases} /></div>
    <p className="muted small">{[c.customer.phone, c.customer.email, c.customer.address].filter(Boolean).join(' · ')} · Registered {String(c.customer.created_at).slice(0, 10)}{c.customer.notes ? ` · ${c.customer.notes}` : ''}</p>
    <div className="row"><button className="btn secondary sm" onClick={() => onEdit(c.customer)}>Edit</button><button className="btn ghost sm" onClick={archive}>Archive</button></div>
    <h4>Sales &amp; credit</h4><div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Due</th><th></th></tr></thead><tbody>
      {c.sales.map((s: any) => <tr key={s.id}><td>{s.receipt_no}</td><td>{String(s.created_at).slice(0, 10)}</td><td className="num">{money(s.total, sym)}</td><td className="num">{money(s.amount_paid, sym)}</td><td className="num">{s.balance_due > 0 ? <b>{money(s.balance_due, sym)}</b> : '—'}</td><td>{s.due_date || '—'}</td><td>{canCredit && s.balance_due > 0 && <button className="btn sm" onClick={() => { setPay(s); setAmount(String(s.balance_due)); }}>Record payment</button>}</td></tr>)}
      {c.sales.length === 0 && <tr><td colSpan={7} className="empty">No purchases yet</td></tr>}</tbody></table></div>
    {pay && <Card><b>Payment for {pay.receipt_no}</b><Err msg={err} /><div className="grid g3"><Field label={`Amount (${sym})`}><input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Method"><select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field><Field label="Reference"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field></div>
      <div className="row"><AsyncButton onClick={submit} disabled={!Number(amount)}>Save payment</AsyncButton><button className="btn secondary" onClick={() => setPay(null)}>Cancel</button></div></Card>}
    <h4>Products purchased</h4><div className="table-wrap"><table><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Returned</th><th>Receipt</th><th>Date</th></tr></thead><tbody>
      {c.items.map((i: any, n: number) => <tr key={n}><td>{i.name}</td><td className="num">{i.quantity}</td><td className="num">{i.returned_qty || '—'}</td><td>{i.receipt_no}</td><td>{String(i.created_at).slice(0, 10)}</td></tr>)}</tbody></table></div>
    <h4>Payment history</h4><div className="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th>Type</th><th className="num">Amount</th></tr></thead><tbody>
      {c.payments.map((p: any) => <tr key={p.id}><td>{String(p.created_at).slice(0, 10)}</td><td>{p.receipt_no}</td><td>{p.method}</td><td>{p.kind}</td><td className="num">{money(p.amount, sym)}</td></tr>)}</tbody></table></div>
    {c.warranties.length > 0 && <><h4>Warranties</h4><div className="table-wrap"><table><thead><tr><th>Product</th><th>Serial / IMEI</th><th>Ends</th><th>Status</th></tr></thead><tbody>{c.warranties.map((w: any) => <tr key={w.id}><td>{w.product_name}</td><td>{w.serial_number || w.imei}</td><td>{w.end_date}</td><td><span className={`badge ${w.status === 'active' ? 'b-ok' : 'b-grey'}`}>{w.status.replace('_', ' ')}</span></td></tr>)}</tbody></table></div></>}
  </>}</Modal>);
}
