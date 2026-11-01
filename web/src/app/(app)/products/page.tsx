'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi, post, put, del, money, num } from '@/lib/api';
import { Page, Card, Loading, Err, StatusBadge, Thumb, Modal, Field, AsyncButton, useToast } from '@/components/ui';
import { useMe } from '@/lib/me';

function Inner() {
  const me = useMe(); const toast = useToast(); const sym = me.currency_symbol; const can = (p: string) => me.permissions.includes(p);
  const sp = useSearchParams();
  const [q, setQ] = useState(''); const [stock, setStock] = useState(sp.get('stock') || ''); const [cat, setCat] = useState(''); const [brand, setBrand] = useState('');
  const [min, setMin] = useState(''); const [max, setMax] = useState('');
  const qs = new URLSearchParams({ q, limit: '100', ...(stock && { stock }), ...(cat && { category_id: cat }), ...(brand && { brand_id: brand }), ...(min && { min_price: min }), ...(max && { max_price: max }) }).toString();
  const list = useApi<any>(`/products?${qs}`, { interval: 8000 });
  const cats = useApi<any>('/categories'); const brands = useApi<any>('/brands');
  const [adj, setAdj] = useState<any>(null); const [price, setPrice] = useState<any>(null);

  return (<Page title="Products & Stock" sub="Search live inventory. Figures refresh automatically."
    actions={<>{can('products.create') && <Link className="btn" href="/products/new">+ Add new product</Link>}</>}>
    <Card>
      <div className="grid g4">
        <Field label="Search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, brand, model, SKU, specs…" autoFocus /></Field>
        <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.data?.categories.map((c: any) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</select></Field>
        <Field label="Brand"><select value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">All</option>{brands.data?.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Availability"><select value={stock} onChange={(e) => setStock(e.target.value)}><option value="">All</option><option value="available">Available (1+)</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select></Field>
        <Field label={`Min price (${sym})`}><input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <Field label={`Max price (${sym})`}><input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} /></Field>
      </div>
    </Card>
    <div style={{ height: 14 }} />
    <Card>
      {list.loading && !list.data ? <Loading /> : <><Err msg={list.error} />
        <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th className="num">Price</th>{can('products.view_cost') && <th className="num">Cost</th>}<th className="num">Qty</th><th>Status</th><th></th></tr></thead><tbody>
          {list.data?.items.map((p: any) => (<tr key={p.variation_id}>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}><Thumb url={p.image_url} name={p.name} /><div><b>{p.name}</b>{p.label && <span className="muted"> · {p.label}</span>}{p.is_demo && <span className="badge b-blue" style={{ marginLeft: 6 }}>DEMO</span>}<div className="small muted">{[p.brand, p.model].filter(Boolean).join(' · ')}</div></div></div></td>
            <td className="small">{p.sku}</td><td className="small">{p.subcategory || p.category || '—'}</td>
            <td className="num"><b>{money(p.selling_price, sym)}</b></td>{can('products.view_cost') && <td className="num muted">{money(p.purchase_price, sym)}</td>}
            <td className="num"><b>{num(p.quantity)}</b><div className="small muted">min {p.min_stock}</div></td><td><StatusBadge status={p.status} /></td>
            <td className="nowrap right">
              {can('stock.adjust') && <button className="btn secondary sm" onClick={() => setAdj(p)}>Stock</button>} {can('products.edit_price') && <button className="btn secondary sm" onClick={() => setPrice(p)}>Price</button>} {can('products.edit') && <Link className="btn secondary sm" href={`/products/${p.product_id}`}>Edit</Link>}
            </td></tr>))}
          {list.data?.items.length === 0 && <tr><td colSpan={8} className="empty">{list.data.message || 'No products found.'}</td></tr>}
        </tbody></table></div>
        <div className="small muted" style={{ marginTop: 8 }}>{list.data?.total} item(s)</div></>}
    </Card>
    {can('products.create') && list.data && list.data.total === 0 && !q && <div className="alert info" style={{ marginTop: 14 }}>New here? <AsyncButton className="btn sm" onClick={async () => { await post('/demo-data'); toast('Sample products added (marked DEMO)'); list.reload(); }}>Load sample products</AsyncButton> They are clearly labelled DEMO and can be removed later from Settings.</div>}
    {adj && <StockModal p={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); list.reload(); }} />}
    {price && <PriceModal p={price} sym={sym} onClose={() => setPrice(null)} onDone={() => { setPrice(null); list.reload(); }} />}
  </Page>);
}
export default function Products() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }

function StockModal({ p, onClose, onDone }: any) {
  const toast = useToast();
  const [action, setAction] = useState('restock'); const [qty, setQty] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    try { const r = await post(`/inventory/${p.variation_id}/adjust`, { action, quantity: Number(qty), reason }); toast(`Stock updated: ${r.quantity_before} → ${r.quantity_after}`); onDone(); } catch (e: any) { setErr(e.message); }
  }
  return (<Modal title={`Stock — ${p.name}${p.label ? ' (' + p.label + ')' : ''}`} onClose={onClose}>
    <p>Current quantity: <b>{p.quantity}</b></p><Err msg={err} />
    <Field label="What happened?"><select value={action} onChange={(e) => setAction(e.target.value)}>
      <option value="restock">Restock — new stock arrived</option><option value="manual_add">Correction — add</option><option value="manual_remove">Correction — remove</option>
      <option value="damaged">Damaged</option><option value="missing">Missing / lost</option><option value="removed">Removed from shop</option></select></Field>
    <Field label="Quantity"><input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
    <Field label={action === 'restock' ? 'Note (optional)' : 'Reason (required)'}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    <AsyncButton onClick={save} disabled={!qty}>Save</AsyncButton>
  </Modal>);
}
function PriceModal({ p, sym, onClose, onDone }: any) {
  const toast = useToast(); const cost = useMe().permissions.includes('products.view_cost');
  const [sell, setSell] = useState(String(p.selling_price)); const [buy, setBuy] = useState(String(p.purchase_price ?? '')); const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    try { await put(`/variations/${p.variation_id}`, { selling_price: Number(sell), ...(cost && buy !== '' ? { purchase_price: Number(buy) } : {}) }); toast('Price updated'); onDone(); } catch (e: any) { setErr(e.message); }
  }
  return (<Modal title={`Price — ${p.name}`} onClose={onClose}><Err msg={err} />
    <Field label={`Selling price (${sym})`}><input type="number" min={0} step="0.01" value={sell} onChange={(e) => setSell(e.target.value)} autoFocus /></Field>
    {cost && <Field label={`Purchase price (${sym})`}><input type="number" min={0} step="0.01" value={buy} onChange={(e) => setBuy(e.target.value)} /></Field>}
    <AsyncButton onClick={save}>Save price</AsyncButton></Modal>);
}
