'use client';
import { useState } from 'react';
import { useApi, post, put } from '@/lib/api';
import { Page, Card, Loading, Err, Field, Modal, AsyncButton, useToast } from '@/components/ui';

const STATUS: Record<string, string> = { active: 'b-ok', expired: 'b-grey', under_review: 'b-warn', claimed: 'b-blue', completed: 'b-grey' };
const label = (s: string) => s.replace('_', ' ');

export default function Warranties() {
  const toast = useToast(); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [soon, setSoon] = useState(false);
  const list = useApi<any>(`/warranties?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${soon ? '&expiring_days=30' : ''}`);
  const [adding, setAdding] = useState(false); const [open, setOpen] = useState<string | null>(null);
  return (<Page title="Warranties & serial numbers" sub="Look up a device by serial number or IMEI, track warranty and service claims" actions={<button className="btn" onClick={() => setAdding(true)}>+ Register warranty</button>}>
    <Card><div className="row" style={{ marginBottom: 10 }}><input placeholder="Search serial, IMEI, product, customer or receipt" value={q} onChange={(e) => setQ(e.target.value)} />
      <select style={{ maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.keys(STATUS).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={soon} onChange={(e) => setSoon(e.target.checked)} />Ending in 30 days</label></div>
      {list.loading && !list.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Product</th><th>Serial / IMEI</th><th>Customer</th><th>Ends</th><th>Status</th><th></th></tr></thead><tbody>
        {list.data?.warranties.map((w: any) => <tr key={w.id}><td><b>{w.product_name}</b><div className="muted small">{w.receipt_no || ''}</div></td><td className="small">{w.serial_number}{w.serial_number && w.imei ? <br /> : null}{w.imei}</td><td>{w.customer_name || '—'}</td><td className="nowrap">{w.end_date}{w.status === 'active' && w.days_left <= 30 ? <div className="small muted">{w.days_left} days left</div> : null}</td>
          <td><span className={`badge ${STATUS[w.status]}`}>{label(w.status)}</span></td><td className="right"><button className="btn secondary sm" onClick={() => setOpen(w.id)}>Open</button></td></tr>)}
        {list.data?.warranties.length === 0 && <tr><td colSpan={6} className="empty">No warranties found</td></tr>}</tbody></table></div>}</Card>
    {adding && <AddWarranty onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); toast('Warranty registered'); }} />}
    {open && <Detail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
  </Page>);
}

function AddWarranty({ onClose, onSaved }: any) {
  const [f, setF] = useState({ product_name: '', serial_number: '', imei: '', duration_months: '12', start_date: '', conditions: '' }); const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function save() { setErr(null); try { await post('/warranties', { ...f, duration_months: Number(f.duration_months), serial_number: f.serial_number || undefined, imei: f.imei || undefined, start_date: f.start_date || undefined, conditions: f.conditions || undefined }); onSaved(); } catch (e: any) { setErr(e.message); } }
  return (<Modal title="Register warranty" onClose={onClose}><Err msg={err} /><Field label="Product"><input value={f.product_name} onChange={set('product_name')} placeholder="e.g. HP Pavilion 15" /></Field>
    <div className="grid g2"><Field label="Serial number"><input value={f.serial_number} onChange={set('serial_number')} /></Field><Field label="IMEI (phones)"><input value={f.imei} onChange={set('imei')} inputMode="numeric" /></Field></div>
    <div className="grid g2"><Field label="Duration (months)"><input type="number" min={1} max={120} value={f.duration_months} onChange={set('duration_months')} /></Field><Field label="Start date" hint="Leave empty for today"><input type="date" value={f.start_date} onChange={set('start_date')} /></Field></div>
    <Field label="Warranty conditions"><textarea value={f.conditions} onChange={set('conditions')} /></Field><AsyncButton onClick={save} disabled={f.product_name.trim().length < 2 || (!f.serial_number && !f.imei)}>Save</AsyncButton></Modal>);
}

function Detail({ id, onClose }: any) {
  const d = useApi<any>(`/warranties/${id}`); const toast = useToast(); const [issue, setIssue] = useState(''); const [err, setErr] = useState<string | null>(null); const [outcome, setOutcome] = useState('');
  async function run(fn: () => Promise<any>, ok: string) { setErr(null); try { await fn(); toast(ok); setIssue(''); setOutcome(''); d.reload(); } catch (e: any) { setErr(e.message); } }
  const w = d.data?.warranty; const claims: any[] = d.data?.claims || []; const openClaim = claims.find((c) => c.status === 'open' || c.status === 'in_service');
  return (<Modal title={w?.product_name || 'Warranty'} onClose={onClose}>{!w ? <Loading /> : <>
    <p><span className={`badge ${STATUS[w.status]}`}>{label(w.status)}</span> {w.serial_number && <>S/N <b>{w.serial_number}</b> </>}{w.imei && <>IMEI <b>{w.imei}</b></>}</p>
    <p className="muted small">{w.start_date} → {w.end_date} ({w.duration_months} months){w.customer_name ? ` · ${w.customer_name}` : ''}{w.receipt_no ? ` · ${w.receipt_no}` : ''}</p>{w.conditions && <p className="small">{w.conditions}</p>}
    <Err msg={err} />
    {!openClaim && w.status === 'active' && <Card><Field label="Open a warranty claim"><textarea value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Describe the fault" /></Field><AsyncButton onClick={() => run(() => post(`/warranties/${id}/claims`, { issue }), 'Claim opened')} disabled={issue.trim().length < 3}>Open claim</AsyncButton></Card>}
    {openClaim && <Card><b>Open claim:</b> {openClaim.issue}{openClaim.status === 'open' && <div style={{ marginTop: 8 }}><AsyncButton className="btn secondary" onClick={() => run(() => put(`/warranties/${id}/claims/${openClaim.id}`, { status: 'in_service' }), 'Marked in service')}>Send for service</AsyncButton></div>}
      <Field label="Outcome"><input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Screen replaced" /></Field>
      <div className="row"><AsyncButton onClick={() => run(() => put(`/warranties/${id}/claims/${openClaim.id}`, { status: 'resolved', resolution: outcome }), 'Claim completed')} disabled={!outcome.trim()}>Complete</AsyncButton><AsyncButton className="btn danger" onClick={() => run(() => put(`/warranties/${id}/claims/${openClaim.id}`, { status: 'rejected', resolution: outcome }), 'Claim rejected')} disabled={!outcome.trim()}>Reject</AsyncButton></div></Card>}
    <h4>Service history</h4>{claims.length === 0 ? <p className="muted">No claims yet.</p> : claims.map((c) => <div key={c.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--row-line)' }}><b>{String(c.created_at).slice(0, 10)}</b> · {label(c.status)} · {c.issue}{c.resolution ? ` → ${c.resolution}` : ''}</div>)}
  </>}</Modal>);
}
