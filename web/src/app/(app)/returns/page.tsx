'use client';
import { useState } from 'react';
import { useApi, get, post, money, dt } from '@/lib/api';
import { Page, Card, Loading, Err, Modal, Field, AsyncButton, useToast } from '@/components/ui';
import { useMe } from '@/lib/me';

const RS: any = { pending_inspection: ['b-warn', 'Awaiting inspection'], inspected: ['b-ok', 'Inspected'], rejected: ['b-bad', 'Rejected'] };
const FS: any = { none: ['b-grey', 'No refund'], requested: ['b-warn', 'Refund requested'], paid: ['b-ok', 'Refunded'], denied: ['b-bad', 'Refund denied'] };

export default function Returns() {
  const me = useMe(); const sym = me.currency_symbol; const toast = useToast(); const can = (p: string) => me.permissions.includes(p);
  const list = useApi<any>('/returns', { interval: 15000 });
  const [newOpen, setNewOpen] = useState(false); const [view, setView] = useState<any>(null);
  return (<Page title="Returns & exchanges" sub="Returned items go back on the shelf only after inspection." actions={<button className="btn" onClick={() => setNewOpen(true)}>+ New return / exchange</button>}>
    <Card>{list.loading && !list.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>No.</th><th>Receipt</th><th>Type</th><th>Reason</th><th>Status</th><th>Refund</th><th className="num">Amount</th><th>Date</th><th></th></tr></thead><tbody>
      {list.data?.returns.map((r: any) => <tr key={r.id}><td><b>{r.return_no}</b></td><td>{r.receipt_no}</td><td style={{ textTransform: 'capitalize' }}>{r.type}</td><td className="small">{r.reason}</td>
        <td><span className={`badge ${RS[r.status][0]}`}>{RS[r.status][1]}</span></td><td><span className={`badge ${FS[r.refund_status][0]}`}>{FS[r.refund_status][1]}</span></td><td className="num">{money(r.refund_amount, sym)}</td><td className="small">{dt(r.created_at)}</td>
        <td><button className="btn secondary sm" onClick={async () => setView((await get(`/returns/${r.id}`)).return)}>Open</button></td></tr>)}
      {list.data?.returns.length === 0 && <tr><td colSpan={9} className="empty">No returns yet</td></tr>}</tbody></table></div>}</Card>
    {newOpen && <NewReturn sym={sym} canRefund={can('returns.refund')} onClose={() => setNewOpen(false)} onDone={() => { setNewOpen(false); list.reload(); toast('Return recorded'); }} />}
    {view && <ReturnView r={view} sym={sym} can={can} onClose={() => setView(null)} onChange={async () => { list.reload(); setView((await get(`/returns/${view.id}`)).return); }} />}
  </Page>);
}

function NewReturn({ sym, canRefund, onClose, onDone }: any) {
  const [q, setQ] = useState(''); const sales = useApi<any>(q.length >= 3 ? `/sales?q=${encodeURIComponent(q)}&limit=5` : null);
  const [sale, setSale] = useState<any>(null); const [qty, setQty] = useState<Record<string, number>>({});
  const [type, setType] = useState('return'); const [reason, setReason] = useState(''); const [refund, setRefund] = useState(true); const [method, setMethod] = useState('cash'); const [err, setErr] = useState<string | null>(null);
  async function pick(id: string) { setSale((await get(`/sales/${id}`)).sale); setQty({}); }
  async function save() {
    setErr(null);
    const items = Object.entries(qty).filter(([, n]) => n > 0).map(([sale_item_id, quantity]) => ({ sale_item_id, quantity }));
    try { await post('/returns', { sale_id: sale.id, type, reason, items, request_refund: type === 'return' && refund, refund_method: method }); onDone(); } catch (e: any) { setErr(e.message); }
  }
  return (<Modal title="New return / exchange" wide onClose={onClose}><Err msg={err} />
    {!sale ? <><Field label="Find the original sale (receipt number)"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="RCP-000012" autoFocus /></Field>
      {sales.data?.sales.map((s: any) => <div key={s.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid #eef1f6' }}><span><b>{s.receipt_no}</b> · {dt(s.created_at)} · {money(s.total, sym)}</span><button className="btn sm" onClick={() => pick(s.id)}>Select</button></div>)}
      {sales.data?.sales.length === 0 && <div className="muted">No matching sale</div>}</>
    : <><div className="alert info">Sale <b>{sale.receipt_no}</b> — {money(sale.total, sym)}</div><h3 style={{ marginTop: 14 }}>Items being returned</h3>
      {sale.items.map((i: any) => { const left = i.quantity - i.returned_qty; return <div key={i.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid #eef1f6' }}>
        <span><b>{i.name}</b><div className="small muted">Bought {i.quantity} · already returned {i.returned_qty}</div></span>
        <input type="number" min={0} max={left} disabled={left === 0} value={qty[i.id] || 0} onChange={(e) => setQty({ ...qty, [i.id]: Math.min(left, Math.max(0, Number(e.target.value))) })} style={{ width: 80 }} aria-label={`Return quantity for ${i.name}`} /></div>; })}
      <div className="grid g2" style={{ marginTop: 12 }}>
        <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)}><option value="return">Return (refund)</option><option value="exchange">Exchange (swap for another product)</option></select></Field>
        <Field label="Reason *"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Faulty, wrong size, changed mind…" /></Field></div>
      {type === 'return' && <div className="row"><label className="check"><input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} /> Refund the customer</label>
        {refund && canRefund && <select style={{ width: 170 }} value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="momo">Mobile Money</option><option value="bank_transfer">Bank</option><option value="card">Card</option></select>}
        {refund && !canRefund && <span className="small muted">The refund will wait for owner approval.</span>}</div>}
      {type === 'exchange' && <div className="hint">After recording the exchange, sell the replacement item in the POS as usual.</div>}
      <div style={{ height: 12 }} /><AsyncButton onClick={save} disabled={!reason || !Object.values(qty).some((n) => n > 0)}>Record {type}</AsyncButton></>}
  </Modal>);
}

function ReturnView({ r, sym, can, onClose, onChange }: any) {
  const toast = useToast(); const [insp, setInsp] = useState<Record<string, { condition: string; resellable: boolean }>>({}); const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(null); try { await fn(); toast(ok); onChange(); } catch (e: any) { setErr(e.message); } };
  return (<Modal title={`${r.return_no} · ${r.receipt_no}`} onClose={onClose}><Err msg={err} />
    <p className="muted">{r.reason}</p>
    <table><tbody>{r.items.map((i: any) => <tr key={i.id}><td><b>{i.name}</b><div className="small muted">Qty {i.quantity}{i.condition ? ` · ${i.condition}` : ''}</div></td>
      <td>{r.status === 'pending_inspection' && can('stock.adjust') ? <div><input placeholder="Condition (e.g. unopened)" value={insp[i.id]?.condition || ''} onChange={(e) => setInsp({ ...insp, [i.id]: { condition: e.target.value, resellable: insp[i.id]?.resellable ?? false } })} />
        <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={insp[i.id]?.resellable || false} onChange={(e) => setInsp({ ...insp, [i.id]: { condition: insp[i.id]?.condition || '', resellable: e.target.checked } })} /> Resellable — put back in stock</label></div>
        : i.restocked ? <span className="badge b-ok">Back in stock</span> : r.status === 'inspected' ? <span className="badge b-grey">Not restocked</span> : null}</td></tr>)}</tbody></table>
    {r.status === 'pending_inspection' && can('stock.adjust') && <AsyncButton onClick={() => run(() => post(`/returns/${r.id}/inspect`, { items: r.items.map((i: any) => ({ id: i.id, condition: insp[i.id]?.condition || 'Not described', resellable: !!insp[i.id]?.resellable })) }), 'Inspection saved')}>Save inspection</AsyncButton>}
    {r.status === 'pending_inspection' && !can('stock.adjust') && <div className="alert info">Waiting for someone with stock authority to inspect these items.</div>}
    {r.refund_status === 'requested' && can('returns.refund') && <div className="row" style={{ marginTop: 12 }}><AsyncButton onClick={() => run(() => post(`/returns/${r.id}/refund`, { approve: true, method: 'cash' }), 'Refund paid')}>Approve refund {money(r.refund_amount, sym)}</AsyncButton><AsyncButton className="btn danger" onClick={() => run(() => post(`/returns/${r.id}/refund`, { approve: false }), 'Refund denied')}>Deny</AsyncButton></div>}
  </Modal>);
}
