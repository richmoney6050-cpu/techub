'use client';
import { useState } from 'react';
import Link from 'next/link';
import { post } from '@/lib/api';
import { Err, Field } from '@/components/ui';

export default function Login() {
  const [username, setU] = useState(''); const [password, setP] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/login', { username, password, device: 'Web browser' }); window.location.href = '/'; }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (<div className="auth-wrap"><form className="auth-card" onSubmit={submit}>
    <div className="logo">TECH<span>HUB</span></div><p className="muted" style={{ marginTop: 4 }}>Sign in to manage your shop</p>
    <Err msg={err} />
    <div style={{ height: 10 }} />
    <Field label="Username or email"><input value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></Field>
    <Field label="Password"><input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
    <button className="btn lg" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>New business owner? <Link href="/register">Create your business account</Link><br />Employees: ask the owner for your username and password.</p>
  </form></div>);
}
