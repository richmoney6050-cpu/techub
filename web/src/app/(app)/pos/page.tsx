'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, money, uuid, ApiError } from '@/lib/api';
import { Page, Card, Err, Modal, StatusBadge, Thumb, useToast, AsyncButton, Field } from '@/components/ui';
import { useMe } from '@/lib/me';
import { ReceiptModal } from '@/components/Receipt';

interface Line { variation_id: string; name: string; sku: string; price: number; qty: number; max: number }
const METHODS = [['cash', 'Cash'], ['momo', 'MoMo'], ['bank_transfer', 'Bank'], ['card', 'Card']] as const;

export default function POS() {
  const me = useMe(); const toast = useToast(); const sym = me.currency_symbol;
  const canDiscount = me.permissions.includes('discounts.apply');
  const [q, setQ] = useState(''); const [items, setItems] = useState<any[]>([]); const [msg, setMsg] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<Line[]>([]);
  const [method, setMethod] = useState<string>('cash'); const [paid, setPaid] = useState(''); const [dtype, setDtype] = useState<'amount' | 'percent'>('percent'); const [dval, setDval] = useState('');
  const [customer, setCustomer] = useState(''); const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  // one key per checkout attempt: retrying after a network drop can never double-charge or double-deduct
  const [key, setKey] = useState(uuid());
  const searchRef = useRef<HTMLInputElement>(null);

  async function search(term: string) {
    setLoading(true);
    try { const r = await get(`/products?q=${encodeURIComponent(term)}&limit=60`); setItems(r.items); setMsg(r.message || null); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { const t = setTimeout(() => search(q), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const t = setInterval(() => search(q), 10000); return () => clearInterval(t); }, [q]); // keep stock figures fresh

  function add(p: any, qty = 1) {
    setCart((c) => {
      const i = c.findIndex((l) => l.variation_id === p.variation_id);
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: Math.min(n[i].qty + qty, p.quantity), max: p.quantity }; return n; }
      return [...c, { variation_id: p.variation_id, name: p.label ? `${p.name} (${p.label})` : p.name, sku: p.sku, price: p.selling_price, qty: Math.min(qty, p.quantity), max: p.quantity }];
    });
  }
  // Barcode scanners type the code then press Enter: exact SKU/barcode match adds straight to the cart.
  async function onEnter() {
    const t = q.trim(); if (!t) return;
    const exact = items.find((p) => p.sku.toLowerCase() === t.toLowerCase() || p.barcode === t);
    if (exact && exact.quantity > 0) { add(exact); setQ(''); searchRef.current?.focus(); }
    else if (items.length === 1 && items[0].quantity > 0) { add(items[0]); setQ(''); }
  }
  const setQty = (id: string, v: number) => setCart((c) => c.map((l) => l.variation_id === id ? { ...l, qty: Math.max(1, Math.min(l.max, Math.floor(v) || 1)) } : l));
  const remove = (id: string) => setCart((c) => c.filter((l) => l.variation_id !== id));

  const subtotal = useMemo(() => Math.round(cart.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100, [cart]);
  const dv = Number(dval) || 0;
  const discount = Math.min(subtotal, Math.round((dtype === 'percent' ? subtotal * dv / 100 : dv) * 100) / 100);
  const total = Math.round((subtotal - discount) * 100) / 100;
  const paidNum = paid === '' ? total : Number(paid) || 0;
  const change = Math.max(0, Math.round((paidNum - total) * 100) / 100); const balance = Math.max(0, Math.round((total - paidNum) * 100) / 100);

  async function checkout() {
    setErr(null);
    if (!cart.length) return setErr('Add at least one product to the sale');
    try {
      const r = await post('/sales', {
        idempotency_key: key, items: cart.map((l) => ({ variation_id: l.variation_id, quantity: l.qty })), payment_method: method, amount_paid: paidNum,
        payment_reference: ref || undefined, customer_name: customer || undefined, discount: discount > 0 ? { type: dtype, value: dv } : undefined,
      });
      const rc = await get(`/sales/${r.sale.id}/receipt`);
      setReceipt({ ...rc.receipt, sale_id: r.sale.id });
      setCart([]); setPaid(''); setDval(''); setCustomer(''); setRef(''); setKey(uuid()); search(q);
      toast(r.duplicate ? 'This sale was already recorded' : 'Sale completed ✔', 'ok');
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'insufficient_stock') { setErr(e.message + '. Please reduce the quantity.'); search(q); }
      else setErr(e.message); // network errors keep the cart AND the same key, so pressing again is safe
    }
  }

  return (<Page title="Point of Sale" sub={`Serving as ${me.name}`}>
    <div className="pos">
      <div>
        <Card>
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter()} placeholder="Search by name, brand, model, SKU — or scan a barcode" autoFocus aria-label="Search products" style={{ fontSize: 17, padding: 14 }} />
          {msg && !loading && <div className="alert warn" style={{ marginTop: 10 }}>{msg}</div>}
          <div className="pos-items">
            {items.map((p) => (<button key={p.variation_id} className="pos-item" disabled={p.quantity < 1} onClick={() => add(p)}>
              <div className="row" style={{ flexWrap: 'nowrap' }}><Thumb url={p.image_url} name={p.name} /><div style={{ minWidth: 0 }}><b style={{ display: 'block', lineHeight: 1.2 }}>{p.name}</b>{p.label && <span className="small muted">{p.label}</span>}</div></div>
              <div className="row between" style={{ marginTop: 'auto' }}><b style={{ color: 'var(--navy)' }}>{money(p.selling_price, sym)}</b><StatusBadge status={p.status} /></div>
              <div className="small muted">{p.quantity} available · {p.sku}</div>
            </button>))}
          </div>
        </Card>
      </div>
      <Card className="stack" style={{ position: 'sticky', top: 12 }}>
        <h2>Current sale</h2>
        {cart.length === 0 && <div className="empty">Tap a product to add it</div>}
        {cart.map((l) => (<div key={l.variation_id} className="cart-line">
          <div><b>{l.name}</b><div className="small muted">{money(l.price, sym)} each · {l.max} in stock</div></div>
          <div className="right"><b>{money(l.price * l.qty, sym)}</b><div><button className="btn ghost sm" onClick={() => remove(l.variation_id)}>Remove</button></div></div>
          <div className="qty"><button onClick={() => setQty(l.variation_id, l.qty - 1)} aria-label="Less">−</button><input type="number" min={1} max={l.max} value={l.qty} onChange={(e) => setQty(l.variation_id, Number(e.target.value))} aria-label="Quantity" /><button onClick={() => setQty(l.variation_id, l.qty + 1)} aria-label="More">+</button></div>
        </div>))}
        {canDiscount && cart.length > 0 && <div className="row"><select style={{ width: 120 }} value={dtype} onChange={(e) => setDtype(e.target.value as any)}><option value="percent">Discount %</option><option value="amount">Discount {sym}</option></select><input style={{ width: 110 }} type="number" min={0} value={dval} onChange={(e) => setDval(e.target.value)} placeholder="0" aria-label="Discount" /></div>}
        <div className="totals"><div><span>Subtotal</span><span>{money(subtotal, sym)}</span></div>{discount > 0 && <div><span>Discount</span><span>−{money(discount, sym)}</span></div>}<div className="grand"><span>TOTAL</span><span>{money(total, sym)}</span></div></div>
        <div className="pay-methods">{METHODS.map(([k, l]) => <button key={k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{l}</button>)}</div>
        <div className="grid g2"><Field label="Amount paid"><input type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={String(total)} /></Field>
          {method !== 'cash' ? <Field label="Reference (optional)"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="MoMo / txn ID" /></Field> : <Field label="Customer (optional)"><input value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>}</div>
        {change > 0 && <div className="alert ok"><b>Change to give: {money(change, sym)}</b></div>}
        {balance > 0 && <div className="alert warn">Customer still owes {money(balance, sym)}</div>}
        <Err msg={err} />
        <AsyncButton className="btn lg" style={{ width: '100%' }} onClick={checkout} disabled={!cart.length}>Complete sale · {money(total, sym)}</AsyncButton>
      </Card>
    </div>
    {receipt && <ReceiptModal r={receipt} sym={sym} onClose={() => { setReceipt(null); searchRef.current?.focus(); }} />}
  </Page>);
}
