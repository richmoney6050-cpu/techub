'use client';
import { useEffect, useState } from 'react';
import { useApi, put, post, del, api } from '@/lib/api';
import { Page, Card, Loading, Err, Field, AsyncButton, useToast } from '@/components/ui';

export default function Settings() {
  const toast = useToast(); const s = useApi<any>('/settings'); const [f, setF] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [cp, setCp] = useState({ current_password: '', new_password: '' });
  useEffect(() => { if (s.data) setF(s.data.settings); }, [s.data]);
  if (!f) return <Loading />;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save() { setErr(null); try { await put('/settings', { ...f, default_min_stock: Number(f.default_min_stock), max_discount_percent: Number(f.max_discount_percent) }); toast('Settings saved'); s.reload(); } catch (e: any) { setErr(e.message); } }
  async function logo(file?: File) { if (!file) return; const fd = new FormData(); fd.append('image', file); try { const r = await api('POST', '/settings/logo', fd); setF({ ...f, logo_url: r.logo_url }); toast('Logo updated'); } catch (e: any) { setErr(e.message); } }
  return (<Page title="Business settings">
    <Err msg={err} />
    <div className="grid g2" style={{ marginTop: 10 }}>
      <Card><h2>Business profile</h2>
        <Field label="Business name"><input value={f.name} onChange={set('name')} /></Field><Field label="Address"><input value={f.address || ''} onChange={set('address')} /></Field>
        <div className="grid g2"><Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field><Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
          <Field label="Currency code"><input value={f.currency} onChange={set('currency')} maxLength={3} /></Field><Field label="Currency symbol"><input value={f.currency_symbol} onChange={set('currency_symbol')} maxLength={5} /></Field></div>
        <Field label="Logo" hint="Shown on receipts. JPG or PNG work best for PDF receipts.">{f.logo_url && <img src={f.logo_url} alt="" style={{ maxHeight: 60, display: 'block', marginBottom: 8 }} />}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => logo(e.target.files?.[0])} /></Field>
      </Card>
      <Card><h2>Receipts, stock & notifications</h2>
        <Field label="Receipt footer message"><input value={f.receipt_footer} onChange={set('receipt_footer')} /></Field>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.receipt_show_logo} onChange={set('receipt_show_logo')} /> Show logo on receipts</label>
        <div className="grid g2"><Field label="Default low-stock level" hint="For new products"><input type="number" min={0} value={f.default_min_stock} onChange={set('default_min_stock')} /></Field>
          <Field label="Max discount for employees (%)" hint="Owner is not limited"><input type="number" min={0} max={100} value={f.max_discount_percent} onChange={set('max_discount_percent')} /></Field></div>
        <label className="check"><input type="checkbox" checked={f.notify_in_app} onChange={set('notify_in_app')} /> In-app notifications</label>
        <label className="check" style={{ margin: '8px 0' }}><input type="checkbox" checked={f.notify_push} onChange={set('notify_push')} /> Mobile push notifications</label>
        <label className="check"><input type="checkbox" checked={f.notify_email} onChange={set('notify_email')} /> Email alerts (needs the server email settings)</label>
        <div className="hint">Per-product alert levels are set on each product. Employee permissions are managed under Employees.</div>
      </Card>
    </div>
    <div className="row" style={{ margin: '14px 0' }}><AsyncButton className="btn lg" onClick={save}>Save settings</AsyncButton></div>
    <div className="grid g2">
      <Card><h2>Change my password</h2><Field label="Current password"><input type="password" value={cp.current_password} onChange={(e) => setCp({ ...cp, current_password: e.target.value })} /></Field><Field label="New password"><input type="password" value={cp.new_password} onChange={(e) => setCp({ ...cp, new_password: e.target.value })} /></Field>
        <AsyncButton disabled={!cp.current_password || cp.new_password.length < 8} onClick={async () => { try { await post('/auth/change-password', cp); toast('Password changed'); setCp({ current_password: '', new_password: '' }); } catch (e: any) { setErr(e.message); } }}>Change password</AsyncButton></Card>
      <Card><h2>Sample (DEMO) products</h2><p className="muted">Sample products are labelled DEMO and are separate from your real inventory.</p>
        <div className="row"><AsyncButton className="btn secondary" onClick={async () => { const r = await post('/demo-data'); toast(`${r.added} sample products added`); }}>Load samples</AsyncButton>
          <AsyncButton className="btn danger" onClick={async () => { if (confirm('Remove all DEMO products? Ones with sales history are archived instead.')) { const r = await del('/demo-data'); toast(`${r.removed} removed`); } }}>Remove all DEMO products</AsyncButton></div></Card>
    </div>
  </Page>);
}
