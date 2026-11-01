'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi, post, api } from '@/lib/api';
import { Page, Card, Field, Err, AsyncButton, useToast } from '@/components/ui';
import { useMe } from '@/lib/me';

const BRANDS = ['HP', 'Dell', 'Lenovo', 'Apple', 'Acer', 'ASUS', 'MSI', 'Microsoft Surface', 'Samsung', 'Infinix', 'Tecno', 'Anker', 'Logitech'];
interface V { label: string; sku: string; barcode: string; purchase_price: string; selling_price: string; quantity: string; min_stock: string }
const blank = (): V => ({ label: '', sku: '', barcode: '', purchase_price: '', selling_price: '', quantity: '', min_stock: '' });

export default function NewProduct() {
  const me = useMe(); const sym = me.currency_symbol; const router = useRouter(); const toast = useToast();
  const cats = useApi<any>('/categories'); const brands = useApi<any>('/brands');
  const [f, setF] = useState({ name: '', category: '', subcategory: '', brand: '', model: '', description: '', condition: 'brand_new' });
  const [specs, setSpecs] = useState<{ k: string; v: string }[]>([{ k: '', v: '' }]);
  const [vars, setVars] = useState<V[]>([blank()]);
  const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const setV = (i: number, k: keyof V, v: string) => setVars(vars.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const topCats = (cats.data?.categories || []).filter((c: any) => !c.parent_id);
  const brandNames = Array.from(new Set([...(brands.data?.brands || []).map((b: any) => b.name), ...BRANDS]));

  async function save() {
    setErr(null);
    try {
      const body = {
        name: f.name, category_name: f.category || undefined, subcategory_name: f.subcategory || undefined, brand_name: f.brand || undefined, model: f.model || undefined,
        description: f.description || undefined, condition: f.condition, specs: Object.fromEntries(specs.filter((s) => s.k && s.v).map((s) => [s.k, s.v])),
        variations: vars.map((v) => ({ label: v.label || undefined, sku: v.sku || undefined, barcode: v.barcode || undefined, purchase_price: Number(v.purchase_price || 0), selling_price: Number(v.selling_price), quantity: Number(v.quantity || 0), min_stock: v.min_stock === '' ? undefined : Number(v.min_stock) })),
      };
      const r = await post('/products', body);
      if (file) { const fd = new FormData(); fd.append('image', file); await api('POST', `/products/${r.product_id}/image`, fd).catch((e) => toast('Product saved, but the photo failed: ' + e.message, 'err')); }
      toast('Product added ✔'); router.push('/products');
    } catch (e: any) { setErr(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  return (<Page title="Add new product" sub="Each colour/size/model variation has its own price and stock.">
    <Err msg={err} />
    <div className="grid g2" style={{ marginTop: 10 }}>
      <Card><h2>Product details</h2>
        <Field label="Product name *"><input value={f.name} onChange={set('name')} placeholder="e.g. HP EliteBook 840 G8" autoFocus /></Field>
        <div className="grid g2">
          <Field label="Category *" hint="Pick one or type a new one"><input list="cats" value={f.category} onChange={set('category')} placeholder="Laptops" /><datalist id="cats">{topCats.map((c: any) => <option key={c.id} value={c.name} />)}</datalist></Field>
          <Field label="Subcategory"><input list="subs" value={f.subcategory} onChange={set('subcategory')} placeholder="Phone Cases" /><datalist id="subs">{(cats.data?.categories || []).filter((c: any) => c.parent_id).map((c: any) => <option key={c.id} value={c.name} />)}</datalist></Field>
          <Field label="Brand"><input list="brands" value={f.brand} onChange={set('brand')} /><datalist id="brands">{brandNames.map((b: any) => <option key={b} value={b} />)}</datalist></Field>
          <Field label="Model"><input value={f.model} onChange={set('model')} /></Field>
        </div>
        <Field label="Condition"><select value={f.condition} onChange={set('condition')}><option value="brand_new">Brand New</option><option value="used">Used</option><option value="refurbished">Refurbished</option></select></Field>
        <Field label="Description"><textarea value={f.description} onChange={set('description')} /></Field>
        <Field label="Photograph" hint="JPG, PNG or WEBP, up to 3MB"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </Card>
      <Card><h2>Specifications</h2>
        {specs.map((s, i) => <div key={i} className="grid g2" style={{ marginBottom: 8 }}>
          <input value={s.k} placeholder="e.g. Processor" onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} aria-label="Spec name" />
          <div className="row" style={{ flexWrap: 'nowrap' }}><input value={s.v} placeholder="e.g. Intel Core i5" onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} aria-label="Spec value" /><button className="btn secondary sm" onClick={() => setSpecs(specs.filter((_, j) => j !== i))} aria-label="Remove">✕</button></div></div>)}
        <button className="btn secondary sm" onClick={() => setSpecs([...specs, { k: '', v: '' }])}>+ Add specification</button>
        <div className="small muted" style={{ marginTop: 8 }}>Examples: Processor, RAM, Storage, Screen size, Compatible phone, Wattage.</div>
      </Card>
    </div>
    <Card style={{ marginTop: 14 }}><div className="row between"><h2>Variations, prices & stock</h2><button className="btn secondary sm" onClick={() => setVars([...vars, blank()])}>+ Add colour / size / variation</button></div>
      {vars.map((v, i) => (<div key={i} style={{ borderTop: i ? '1px solid var(--line)' : 0, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
        <div className="grid g4">
          <Field label="Variation (colour, size…)"><input value={v.label} onChange={(e) => setV(i, 'label', e.target.value)} placeholder="Black / 256GB" /></Field>
          <Field label="SKU / code" hint="Leave empty to auto-generate"><input value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value)} /></Field>
          <Field label="Barcode (optional)"><input value={v.barcode} onChange={(e) => setV(i, 'barcode', e.target.value)} /></Field>
          <div />
          <Field label={`Purchase price (${sym})`}><input type="number" min={0} step="0.01" value={v.purchase_price} onChange={(e) => setV(i, 'purchase_price', e.target.value)} /></Field>
          <Field label={`Selling price (${sym}) *`}><input type="number" min={0} step="0.01" value={v.selling_price} onChange={(e) => setV(i, 'selling_price', e.target.value)} /></Field>
          <Field label="Available quantity"><input type="number" min={0} value={v.quantity} onChange={(e) => setV(i, 'quantity', e.target.value)} /></Field>
          <Field label="Minimum stock alert" hint="Alert when stock reaches this"><input type="number" min={0} value={v.min_stock} onChange={(e) => setV(i, 'min_stock', e.target.value)} placeholder="2" /></Field>
        </div>
        {vars.length > 1 && <button className="btn ghost sm" onClick={() => setVars(vars.filter((_, j) => j !== i))}>Remove this variation</button>}
      </div>))}
    </Card>
    <div className="row" style={{ marginTop: 16 }}><AsyncButton className="btn lg" onClick={save} disabled={!f.name || vars.some((v) => v.selling_price === '')}>Save product</AsyncButton><button className="btn secondary lg" onClick={() => router.push('/products')}>Cancel</button></div>
  </Page>);
}
