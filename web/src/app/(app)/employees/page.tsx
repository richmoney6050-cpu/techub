'use client';
import { useState } from 'react';
import { useApi, get, post, put, dt } from '@/lib/api';
import { Page, Card, Loading, Err, Modal, Field, AsyncButton, useToast } from '@/components/ui';

export default function Employees() {
  const toast = useToast(); const emps = useApi<any>('/employees'); const roles = useApi<any>('/roles'); const perms = useApi<any>('/permissions');
  const [edit, setEdit] = useState<any>(null); const [pw, setPw] = useState<any>(null); const [logs, setLogs] = useState<any>(null);
  const employees = (emps.data?.employees || []).filter((e: any) => e.role === 'employee');
  return (<Page title="Employees" sub="Create accounts and choose exactly what each person can do." actions={<button className="btn" onClick={() => setEdit({})}>+ Add employee</button>}>
    <Card>{emps.loading && !emps.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Contact</th><th>Role</th><th>Status</th><th>Last activity</th><th className="num">Sales</th><th></th></tr></thead><tbody>
      {employees.map((e: any) => <tr key={e.id}><td><b>{e.name}</b></td><td>{e.username}</td><td className="small">{e.phone}<br />{e.email}</td><td>{e.role_name || 'Custom'}</td><td><span className={`badge ${e.is_active ? 'b-ok' : 'b-bad'}`}>{e.is_active ? 'Active' : 'Deactivated'}</span></td><td className="small">{e.last_activity ? dt(e.last_activity) : '—'}</td><td className="num">{e.sales_count}</td>
        <td className="nowrap right"><button className="btn secondary sm" onClick={() => setEdit(e)}>Edit</button> <button className="btn secondary sm" onClick={() => setPw(e)}>Password</button> <button className="btn secondary sm" onClick={async () => setLogs({ e, rows: (await get(`/audit-logs?user_id=${e.id}&limit=100`)).logs })}>Activity</button></td></tr>)}
      {employees.length === 0 && <tr><td colSpan={8} className="empty">No employees yet. Add your first employee to let them process sales.</td></tr>}</tbody></table></div>}</Card>
    {edit && <EmpForm e={edit} roles={roles.data?.roles || []} perms={(perms.data?.permissions || []).filter((p: any) => !p.owner_only)} onClose={() => setEdit(null)} onDone={() => { setEdit(null); emps.reload(); toast('Saved'); }} />}
    {pw && <PwForm e={pw} onClose={() => setPw(null)} />}
    {logs && <Modal wide title={`Activity — ${logs.e.name}`} onClose={() => setLogs(null)}><table><tbody>{logs.rows.map((l: any) => <tr key={l.id}><td className="small nowrap">{dt(l.created_at)}</td><td><b>{l.action}</b></td><td className="small muted">{l.details && Object.keys(l.details).length ? JSON.stringify(l.details).slice(0, 90) : ''}</td></tr>)}{logs.rows.length === 0 && <tr><td className="empty">No activity</td></tr>}</tbody></table></Modal>}
  </Page>);
}
function EmpForm({ e, roles, perms, onClose, onDone }: any) {
  const isNew = !e.id;
  const [f, setF] = useState({ name: e.name || '', phone: e.phone || '', email: e.email || '', username: e.username || '', password: '', is_active: e.is_active ?? true, role_id: e.role_id || '' });
  const [sel, setSel] = useState<string[]>(e.permissions || ['products.view', 'sales.create', 'sales.view']); const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (ev: any) => setF({ ...f, [k]: ev.target.value });
  const toggle = (k: string) => setSel(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
  function applyRole(id: string) { setF({ ...f, role_id: id }); const r = roles.find((x: any) => x.id === id); if (r) setSel(r.permissions.filter((p: string) => perms.some((x: any) => x.key === p))); }
  async function save() {
    setErr(null);
    try {
      const body: any = { name: f.name, phone: f.phone || null, email: f.email || null, username: f.username, permissions: sel, role_id: f.role_id || null };
      if (isNew) await post('/employees', { ...body, password: f.password }); else await put(`/employees/${e.id}`, { ...body, is_active: f.is_active });
      onDone();
    } catch (x: any) { setErr(x.message); }
  }
  return (<Modal wide title={isNew ? 'Add employee' : `Edit ${e.name}`} onClose={onClose}><Err msg={err} />
    <div className="grid g2"><Field label="Full name *"><input value={f.name} onChange={set('name')} autoFocus /></Field><Field label="Username *"><input value={f.username} onChange={set('username')} /></Field>
      <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field><Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
      {isNew && <Field label="Password *" hint="At least 8 characters, letters and numbers"><input type="text" value={f.password} onChange={set('password')} /></Field>}
      <Field label="Role template"><select value={f.role_id} onChange={(ev) => applyRole(ev.target.value)}><option value="">Custom</option>{roles.filter((r: any) => !r.is_system).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field></div>
    {!isNew && <label className="check" style={{ marginBottom: 10 }}><input type="checkbox" checked={f.is_active} onChange={(ev) => setF({ ...f, is_active: ev.target.checked })} /> Account active (untick to deactivate — they are signed out immediately)</label>}
    <h3>What can this person do?</h3><div className="grid g2">{perms.map((p: any) => <label key={p.key} className="check" style={{ padding: '4px 0' }}><input type="checkbox" checked={sel.includes(p.key)} onChange={() => toggle(p.key)} /> <span>{p.description}</span></label>)}</div>
    <div style={{ height: 14 }} /><AsyncButton onClick={save} disabled={!f.name || !f.username || (isNew && !f.password)}>{isNew ? 'Create employee' : 'Save changes'}</AsyncButton></Modal>);
}
function PwForm({ e, onClose }: any) {
  const toast = useToast(); const [p, setP] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (<Modal title={`Reset password — ${e.name}`} onClose={onClose}><Err msg={err} /><Field label="New password" hint="They will be signed out on all devices"><input value={p} onChange={(x) => setP(x.target.value)} autoFocus /></Field>
    <AsyncButton disabled={p.length < 8} onClick={async () => { try { await post(`/employees/${e.id}/reset-password`, { password: p }); toast('Password changed'); onClose(); } catch (x: any) { setErr(x.message); } }}>Change password</AsyncButton></Modal>);
}
