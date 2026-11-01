'use client';
import { useState } from 'react';
import { useApi, get, post, money, dt } from '@/lib/api';
import { Page, Card, Loading, Err, Modal, Field, AsyncButton, useToast, Err as E } from '@/components/ui';
import { useMe } from '@/lib/me';

export default function Suppliers() {
  const me = useMe(); const sym = me.currency_symbol; const toast = useToast();
  const [tab, setTab] = useState<'po' | 'sup'>('po');
  const sups = useApi<any>('/suppliers'); const pos = useApi<any>('/purchase-orders', { interval: 15000 });
  const [supOpen, setSupOpen] = useState(false); const [poOpen, setPoOpen] = useState(false); const [view, setView] = useState<any>(null);
  const owed = (sups.data?.suppliers || []).reduce((s: number, x: any) => s + x.outstanding, 0);
  return (<Page title="Suppliers & restocking" sub={`Outstanding supplier payments: ${money(owed, sym)}`} actions={<><button className="btn secondary" onClick={() => setSupOpen(true)}>+ Supplier</button><button className="btn" onClick={() => setPoOpen(true)}>+ Purchase order</button></>}>
    <div className="tabs"><button className={tab === 'po' ? 'on' : ''} onClick={() => setTab('po')}>Purchase orders</button><button className={tab === 'sup' ? 'on' : ''} onClick={() => setTab('sup')}>Suppliers</button></div>
    {tab === 'po' ? <Card>{pos.loading && !pos.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Owing</th><th>Date</th><th></th></tr></thead><tbody>
      {pos.data?.purchase_orders.map((p: any) => <tr key={p.id}><td><b>{p.po_number}</b></td><td>{p.supplier_name}</td><td><span className={`badge ${p.status === 'received' ? 'b-ok' : p.status === 'cancelled' ? 'b-bad' : 'b-warn'}`}>{p.status.replace('_', ' ')}</span></td><td className="num">{money(p.total_cost, sym)}</td><td className="num">{money(p.amount_paid, sym)}</td><td className="num"><b>{money(p.outstanding, sym)}</b></td><td className="small">{dt(p.created_at)}</td>
        <td><button className="btn secondary sm" onClick={async () => setView((await get(`/purchase-orders/${p.id}`)).purchase_order)}>Open</button></td></tr>)}
      {pos.data?.purchase_orders.length === 0 && <tr><td colSpan={8} className="empty">No purchase orders yet</td></tr>}</tbody></table></div>}</Card>
    : <Card><div className="table-wrap"><table><thead><tr><th>Supplier</th><th>Phone</th><th>Address</th><th>Supplies</th><th className="num">Orders</th><th className="num">Owing</th></tr></thead><tbody>
      {sups.data?.suppliers.map((s: any) => <tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone}</td><td className="small">{s.address}</td><td className="small">{s.products_supplied}</td><td className="num">{s.orders}</td><td className="num"><b>{money(s.outstanding, sym)}</b></td></tr>)}
      {sups.data?.suppliers.length === 0 && <tr><td colSpan={6} className="empty">No suppliers yet</td></tr>}</tbody></table></div></Card>}
    {supOpen && <SupplierForm onClose={() => setSupOpen(false)} onDone={() => { setSupOpen(false); sups.reload(); toast('Supplier saved'); }} />}
    {poOpen && <PoForm sups={sups.data?.suppliers || []} sym={sym} onClose={() => setPoOpen(false)} onDone={() => { setPoOpen(false); pos.reload(); sups.reload(); toast('Purchase order created'); }} />}
    {view && <PoView po={view} sym={sym} onClose={() => setView(null)} onChange={async () => { pos.reload(); sups.reload(); setView((await get(`/purchase-orders/${view.id}`)).purchase_order); }} />}
  </Page>);
}
function SupplierForm({ onClose, onDone }: any) {
  const [f, setF] = useState({ name: '', phone: '', email: '', address: '', products_supplied: '' }); const [err, setErr] = useState<string | null>(null); const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (<Modal title="New supplier" onClose={onClose}><E msg={err} /><Field label="Name *"><input value={f.name} onChange={set('name')} autoFocus /></Field><Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field><Field label="Email"><input value={f.email} onChange={set('email')} /></Field><Field label="Address"><input value={f.address} onChange={set('address')} /></Field><Field label="Products supplied"><input value={f.products_supplied} onChange={set('products_supplied')} placeholder="Laptops, chargers…" /></Field>
    <AsyncButton disabled={!f.name} onClick={async () => { try { await post('/suppliers', f); onDone(); } catch (e: any) { setErr(e.message); } }}>Save supplier</AsyncButton></Modal>);
}
function PoForm({ sups, sym, onClose, onDone }: any) {
  const [sid, setSid] = useState(''); const [q, setQ] = useState(''); const found = useApi<any>(q.length >= 2 ? `/products?q=${encodeURIComponent(q)}&limit=8` : null);
  const [lines, setLines] = useState<any[]>([]); const [err, setErr] = useState<string | null>(null);
  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
  return (<Modal wide title="New purchase order" onClose={onClose}><E msg={err} />
    <Field label="Supplier *"><select value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Choose…</option>{sups.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <Field label="Add products"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products to order…" /></Field>
    {found.data?.items.map((p: any) => <button key={p.variation_id} className="btn secondary sm" style={{ margin: '0 6px 6px 0' }} onClick={() => { if (!lines.find((l) => l.variation_id === p.variation_id)) setLines([...lines, { variation_id: p.variation_id, name: p.label ? `${p.name} (${p.label})` : p.name, quantity: 1, unit_cost: p.purchase_price || 0 }]); setQ(''); }}>+ {p.name}{p.label ? ` (${p.label})` : ''}</button>)}
    {lines.map((l, i) => <div key={l.variation_id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid #eef1f6' }}><b>{l.name}</b><div className="row"><input type="number" min={1} style={{ width: 80 }} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} aria-label="Quantity" /><input type="number" min={0} step="0.01" style={{ width: 110 }} value={l.unit_cost} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unit_cost: Number(e.target.value) } : x))} aria-label="Unit cost" /><button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></div></div>)}
    <p><b>Total: {money(total, sym)}</b></p><AsyncButton disabled={!sid || !lines.length} onClick={async () => { try { await post('/purchase-orders', { supplier_id: sid, items: lines.map(({ variation_id, quantity, unit_cost }) => ({ variation_id, quantity, unit_cost })) }); onDone(); } catch (e: any) { setErr(e.message); } }}>Create order</AsyncButton></Modal>);
}
function PoView({ po, sym, onClose, onChange }: any) {
  const toast = useToast(); const [recv, setRecv] = useState<Record<string, number>>({}); const [pay, setPay] = useState(''); const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(null); try { await fn(); toast(ok); onChange(); } catch (e: any) { setErr(e.message); } };
  const open = po.status === 'ordered' || po.status === 'partially_received';
  return (<Modal wide title={`${po.po_number} · ${po.supplier_name}`} onClose={onClose}><E msg={err} />
    <table><thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Unit cost</th>{open && <th>Receive now</th>}</tr></thead><tbody>
      {po.items.map((i: any) => <tr key={i.id}><td>{i.name}</td><td className="num">{i.qty_ordered}</td><td className="num">{i.qty_received}</td><td className="num">{money(i.unit_cost, sym)}</td>{open && <td><input type="number" min={0} max={i.qty_ordered - i.qty_received} style={{ width: 90 }} value={recv[i.id] ?? ''} placeholder={String(i.qty_ordered - i.qty_received)} onChange={(e) => setRecv({ ...recv, [i.id]: Number(e.target.value) })} /></td>}</tr>)}</tbody></table>
    {open && <div className="row" style={{ marginTop: 12 }}><AsyncButton onClick={() => run(() => post(`/purchase-orders/${po.id}/receive`, { items: po.items.filter((i: any) => i.qty_received < i.qty_ordered).map((i: any) => ({ item_id: i.id, quantity: recv[i.id] ?? (i.qty_ordered - i.qty_received) })).filter((x: any) => x.quantity > 0), update_cost: true }), 'Stock received and inventory updated')}>Receive stock</AsyncButton>
      {po.status === 'ordered' && <AsyncButton className="btn danger" onClick={() => run(() => post(`/purchase-orders/${po.id}/cancel`), 'Order cancelled')}>Cancel order</AsyncButton>}</div>}
    <h3 style={{ marginTop: 18 }}>Payments — owing {money(po.total_cost - po.amount_paid, sym)}</h3>
    {po.payments.map((p: any, i: number) => <div key={i} className="small">{dt(p.created_at)} · {money(p.amount, sym)} {p.method && `(${p.method})`}</div>)}
    {po.status !== 'cancelled' && po.total_cost > po.amount_paid && <div className="row" style={{ marginTop: 8 }}><input type="number" min={0} step="0.01" style={{ width: 140 }} value={pay} onChange={(e) => setPay(e.target.value)} placeholder="Amount" /><AsyncButton className="btn secondary" disabled={!pay} onClick={() => run(async () => { await post(`/purchase-orders/${po.id}/payments`, { amount: Number(pay) }); setPay(''); }, 'Payment recorded')}>Record payment</AsyncButton></div>}
  </Modal>);
}
