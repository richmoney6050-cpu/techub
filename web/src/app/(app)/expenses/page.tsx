'use client';
import { useState } from 'react';
import { useApi, post, del, money } from '@/lib/api';
import { Page, Card, Loading, Err, Field, AsyncButton, useToast } from '@/components/ui';
import { useMe } from '@/lib/me';

const CATS = ['Rent', 'Electricity', 'Internet', 'Salaries', 'Transport', 'Marketing', 'Repairs', 'Other'];
export default function Expenses() {
  const me = useMe(); const sym = me.currency_symbol; const toast = useToast(); const can = me.permissions.includes('expenses.manage');
  const list = useApi<any>('/expenses'); const [f, setF] = useState({ category: 'Rent', payment_method: 'cash', description: '', amount: '', expense_date: '' }); const [err, setErr] = useState<string | null>(null);
  const total = (list.data?.expenses || []).reduce((s: number, e: any) => s + e.amount, 0);
  async function add() { setErr(null); try { await post('/expenses', { ...f, amount: Number(f.amount), expense_date: f.expense_date || undefined }); setF({ ...f, description: '', amount: '' }); list.reload(); toast('Expense recorded'); } catch (e: any) { setErr(e.message); } }
  return (<Page title="Expenses" sub={`Total shown: ${money(total, sym)}. Expenses reduce net profit in reports.`}>
    {can && <Card><Err msg={err} /><div className="grid g4"><Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field><Field label={`Amount (${sym})`}><input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Paid with"><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank_transfer">Bank</option><option value="card">Card</option></select></Field>
      <Field label="Date"><input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field></div><AsyncButton onClick={add} disabled={!f.amount}>Add expense</AsyncButton></Card>}
    <div style={{ height: 14 }} />
    <Card>{list.loading && !list.data ? <Loading /> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid with</th><th>Recorded by</th><th className="num">Amount</th><th></th></tr></thead><tbody>
      {list.data?.expenses.map((e: any) => <tr key={e.id}><td>{e.expense_date}</td><td>{e.category}</td><td className="small">{e.description}</td><td>{e.payment_method}</td><td>{e.created_by_name}</td><td className="num"><b>{money(e.amount, sym)}</b></td><td>{can && <button className="btn ghost sm" onClick={async () => { if (confirm('Delete this expense?')) { await del(`/expenses/${e.id}`); list.reload(); } }}>Delete</button>}</td></tr>)}
      {list.data?.expenses.length === 0 && <tr><td colSpan={7} className="empty">No expenses recorded</td></tr>}</tbody></table></div>}</Card>
  </Page>);
}
