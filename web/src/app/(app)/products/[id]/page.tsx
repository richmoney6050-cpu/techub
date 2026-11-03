'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { get, put, post, del, api, money } from '@/lib/api';
import { Page, Card, Field, Err, Loading, AsyncButton, useToast, Modal } from '@/components/ui';
import { useMe } from '@/lib/me';
import { BarcodeSvg, printLabels } from '@/components/Barcode';

export default function EditProduct() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const toast = useToast(); const me = useMe();
  const can = (p: string) => me.permissions.includes(p);
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [confirm, setConfirm] = useState(false);
  const load = () => get(`/products/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (!d) return err ? <Err msg={err} /> : <Loading />;
  const p = d.product;
  const set = (k: string, v: any) => setD({ ...d, product: { ...p, [k]: v } });

  async function save() {
    setErr(null);
    try { await put(`/products/${id}`, { name: p.name, model: p.model, description: p.description, condition: p.condition, specs: p.specs, is_active: p.is_active }); toast('Saved'); load(); } catch (e: any) { setErr(e.message); }
  }
  async function photo(file?: File) {
    if (!file) return; const fd = new FormData(); fd.append('image', file);
    try { const r = await api('POST', `/products/${id}/image`, fd); set('image_url', r.image_url); toast('Photo updated'); } catch (e: any) { setErr(e.message); }
  }
  async function remove() {
    try { const r = await del(`/products/${id}`); toast(r.message); router.push('/products'); } catch (e: any) { setErr(e.message); setConfirm(false); }
  }
  async function saveVar(v: any) {
    try { await put(`/variations/${v.id}`, { label: v.label, barcode: v.barcode || null, min_stock: Number(v.min_stock), is_active: v.is_active, sku: v.sku, ...(can('products.edit_price') ? { selling_price: Number(v.selling_price), ...(can('products.view_cost') ? { purchase_price: Number(v.purchase_price) } : {}) } : {}) }); toast('Variation saved'); load(); }
    catch (e: any) { setErr(e.message); }
  }
  const setVar = (i: number, k: string, val: any) => setD({ ...d, variations: d.variations.map((x: any, j: number) => (j === i ? { ...x, [k]: val } : x)) });
  return (<Page title={p.name} sub={[p.brand, p.model, p.category].filter(Boolean).join(' · ')} actions={can('products.delete') && <button className="btn danger" onClick={() => setConfirm(true)}>Delete product</button>}>
    <Err msg={err} />
    <div className="grid g2" style={{ marginTop: 10 }}>
      <Card><h2>Details</h2>
        <Field label="Name"><input value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Model"><input value={p.model || ''} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Condition"><select value={p.condition} onChange={(e) => set('condition', e.target.value)}><option value="brand_new">Brand New</option><option value="used">Used</option><option value="refurbished">Refurbished</option></select></Field>
        <Field label="Description"><textarea value={p.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={p.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (sellable)</label>
        <div style={{ height: 12 }} /><AsyncButton onClick={save}>Save details</AsyncButton>
      </Card>
      <Card><h2>Photo & specifications</h2>
        {p.image_url ? <img src={p.image_url} alt="" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, marginBottom: 10 }} /> : <div className="muted" style={{ marginBottom: 10 }}>No photo yet</div>}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => photo(e.target.files?.[0])} />
        <h3 style={{ marginTop: 18 }}>Specifications</h3>
        {Object.entries(p.specs || {}).map(([k, v]: any) => <div key={k} className="row between small" style={{ borderBottom: '1px solid #eef1f6', padding: '6px 0' }}><span className="muted">{k}</span><span>{v}</span></div>)}
        {Object.keys(p.specs || {}).length === 0 && <div className="muted small">None recorded</div>}
      </Card>
    </div>
    <Card style={{ marginTop: 14 }}><h2>Variations</h2>
      {d.variations.map((v: any, i: number) => (<div key={v.id} style={{ borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
        <div className="grid g4">
          <Field label="Variation"><input value={v.label || ''} onChange={(e) => setVar(i, 'label', e.target.value)} /></Field>
          <Field label="SKU"><input value={v.sku} onChange={(e) => setVar(i, 'sku', e.target.value)} /></Field>
          <Field label="Barcode"><input value={v.barcode || ''} onChange={(e) => setVar(i, 'barcode', e.target.value)} />
            {can('products.edit') && <div className="row" style={{ marginTop: 6 }}>{!v.barcode && <button type="button" className="btn secondary sm" onClick={async () => { try { const r = await post(`/variations/${v.id}/barcode`); setVar(i, 'barcode', r.barcode); toast('Barcode generated'); } catch (e: any) { toast(e.message, 'err'); } }}>Generate barcode</button>}
              {v.barcode && <button type="button" className="btn secondary sm" onClick={() => printLabels([{ code: v.barcode, name: `${p.name}${v.label ? ' - ' + v.label : ''}`, price: money(v.selling_price, me.currency_symbol), copies: 1 }])}>Print label</button>}</div>}
            {v.barcode && <BarcodeSvg code={v.barcode} height={40} />}</Field>
          <Field label="Min stock alert"><input type="number" min={0} value={v.min_stock} onChange={(e) => setVar(i, 'min_stock', e.target.value)} /></Field>
          <Field label="Selling price"><input type="number" step="0.01" disabled={!can('products.edit_price')} value={v.selling_price} onChange={(e) => setVar(i, 'selling_price', e.target.value)} /></Field>
          {can('products.view_cost') && <Field label="Purchase price"><input type="number" step="0.01" disabled={!can('products.edit_price')} value={v.purchase_price} onChange={(e) => setVar(i, 'purchase_price', e.target.value)} /></Field>}
          <Field label="In stock"><input disabled value={v.quantity} /></Field>
          <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={v.is_active} onChange={(e) => setVar(i, 'is_active', e.target.checked)} /> Active</label>
        </div>
        <AsyncButton className="btn secondary sm" onClick={() => saveVar(v)}>Save variation</AsyncButton>
      </div>))}
      <div className="hint" style={{ marginTop: 10 }}>Quantities change through Stock adjustments, sales, returns and purchase orders, so the history is always accurate.</div>
    </Card>
    {confirm && <Modal title="Delete this product?" onClose={() => setConfirm(false)}><p>This will remove <b>{p.name}</b>. If it has sales history it will be archived instead so your records stay correct.</p><div className="row"><AsyncButton className="btn danger" onClick={remove}>Yes, delete</AsyncButton><button className="btn secondary" onClick={() => setConfirm(false)}>Cancel</button></div></Modal>}
  </Page>);
}
