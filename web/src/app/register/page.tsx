'use client';
import { useState } from 'react';
import Link from 'next/link';
import { post } from '@/lib/api';
import { Err, Field } from '@/components/ui';

export default function Register() {
  const [f, setF] = useState({ business_name: '', owner_name: '', username: '', email: '', phone: '', password: '' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/register', f); window.location.href = '/'; } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (<div className="auth-wrap"><form className="auth-card" onSubmit={submit}>
    <div className="logo">TECH<span>HUB</span></div><p className="muted" style={{ marginTop: 4 }}>Create your business account</p>
    <Err msg={err} />
    <div style={{ height: 10 }} />
    <Field label="Business name"><input value={f.business_name} onChange={set('business_name')} required minLength={2} /></Field>
    <Field label="Your full name"><input value={f.owner_name} onChange={set('owner_name')} required minLength={2} /></Field>
    <div className="grid g2"><Field label="Username"><input value={f.username} onChange={set('username')} required minLength={3} autoComplete="username" /></Field>
      <Field label="Phone"><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field></div>
    <Field label="Email"><input type="email" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
    <Field label="Password" hint="At least 8 characters, with letters and numbers"><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
    <button className="btn lg" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
    <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>Already have an account? <Link href="/login">Sign in</Link></p>
  </form></div>);
}
