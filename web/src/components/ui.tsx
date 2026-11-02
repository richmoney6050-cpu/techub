'use client';
import { ReactNode, useEffect, useState, createContext, useContext, useCallback } from 'react';
import { money } from '@/lib/api';

export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (<div>
    <div className="page-head"><div><h1>{title}</h1>{sub && <div className="muted">{sub}</div>}</div><div className="row no-print">{actions}</div></div>
    {children}
  </div>);
}
export const Card = ({ children, className = '', ...p }: any) => <div className={`card ${className}`} {...p}>{children}</div>;
export const Stat = ({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) =>
  <div className={`card stat ${accent ? 'accent' : ''}`}><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><label className="f">{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>;
}
export const Err = ({ msg }: { msg?: string | null }) => msg ? <div className="alert err" role="alert">{msg}</div> : null;
export const Loading = () => <div className="empty">Loading…</div>;

export function StatusBadge({ status, qty }: { status: string; qty?: number }) {
  const m: any = { in_stock: ['b-ok', 'IN STOCK'], low_stock: ['b-warn', 'LOW STOCK'], out_of_stock: ['b-bad', 'OUT OF STOCK'], completed: ['b-ok', 'Completed'], partially_refunded: ['b-warn', 'Part refunded'], refunded: ['b-bad', 'Refunded'] };
  const [cls, label] = m[status] || ['b-grey', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (<div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="row between no-print" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn secondary sm" onClick={onClose} aria-label="Close">✕</button></div>
      {children}
    </div></div>);
}

const ToastCtx = createContext<(m: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string; kind: string }[]>([]);
  const push = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random(); setItems((x) => [...x, { id, m, kind }]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (<ToastCtx.Provider value={push}>{children}<div className="toast-wrap" aria-live="polite">{items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.m}</div>)}</div></ToastCtx.Provider>);
}

export function Thumb({ url, name }: { url?: string | null; name: string }) {
  return url ? <img className="thumb" src={url} alt="" /> : <div className="thumb">{(name || '?').slice(0, 1).toUpperCase()}</div>;
}

/** Button that disables itself while its async action is running (stops double-clicks). */
export function AsyncButton({ onClick, children, className = 'btn', ...rest }: any) {
  const [busy, setBusy] = useState(false);
  return <button {...rest} className={className} disabled={busy || rest.disabled} onClick={async (e) => { if (busy) return; setBusy(true); try { await onClick(e); } finally { setBusy(false); } }}>{busy ? 'Please wait…' : children}</button>;
}

// ---------- tiny dependency-free SVG charts ----------
export function LineChart({ data, x, series, height = 220, sym = 'GH₵' }: { data: any[]; x: string; series: { key: string; label: string; color: string }[]; height?: number; sym?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, P = { l: 52, r: 12, t: 12, b: 26 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
  const px = (i: number) => P.l + (data.length <= 1 ? 0 : (i * (W - P.l - P.r)) / (data.length - 1));
  const py = (v: number) => P.t + (1 - v / top) * (H - P.t - P.b);
  return (<div>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" onMouseLeave={() => setHover(null)}>
      {[0, .25, .5, .75, 1].map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={py(top * t)} y2={py(top * t)} stroke="var(--line)" /><text x={P.l - 6} y={py(top * t) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">{Math.round(top * t).toLocaleString()}</text></g>)}
      {series.map((s) => <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" points={data.map((d, i) => `${px(i)},${py(Number(d[s.key]) || 0)}`).join(' ')} />)}
      {data.map((d, i) => (i % Math.ceil(data.length / 7) === 0) && <text key={i} x={px(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{String(d[x]).slice(5)}</text>)}
      {data.map((d, i) => <rect key={i} x={px(i) - (W - P.l - P.r) / data.length / 2} y={P.t} width={(W - P.l - P.r) / data.length} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
      {hover !== null && <g><line x1={px(hover)} x2={px(hover)} y1={P.t} y2={H - P.b} stroke="var(--muted)" strokeDasharray="3 3" />{series.map((s) => <circle key={s.key} cx={px(hover)} cy={py(Number(data[hover][s.key]) || 0)} r="4" fill={s.color} />)}</g>}
    </svg>
    {hover !== null ? <div className="small" style={{ minHeight: 20 }}><b>{data[hover][x]}</b> — {series.map((s) => `${s.label}: ${s.key === 'orders' ? data[hover][s.key] : money(data[hover][s.key], sym)}`).join('  ·  ')}</div> : <div className="small muted" style={{ minHeight: 20 }}>Hover or tap the chart for details</div>}
    <div className="legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
  </div>);
}

export function BarChart({ data, x, series, height = 220 }: { data: any[]; x: string; series: { key: string; label: string; color: string }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, P = { l: 40, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const gw = (W - P.l - P.r) / Math.max(1, data.length); const bw = Math.max(3, (gw * 0.7) / series.length);
  const py = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  return (<div>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" onMouseLeave={() => setHover(null)}>
      {[0, .5, 1].map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={py(max * t)} y2={py(max * t)} stroke="var(--line)" /><text x={P.l - 6} y={py(max * t) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">{Math.round(max * t)}</text></g>)}
      {data.map((d, i) => <g key={i} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
        <rect x={P.l + i * gw} y={P.t} width={gw} height={H - P.t - P.b} fill={hover === i ? 'var(--hover)' : 'transparent'} />
        {series.map((s, j) => <rect key={s.key} x={P.l + i * gw + gw * 0.15 + j * bw} y={py(Number(d[s.key]) || 0)} width={bw - 1} height={H - P.b - py(Number(d[s.key]) || 0)} fill={s.color} rx="2" />)}
        {i % Math.ceil(data.length / 7) === 0 && <text x={P.l + i * gw + gw / 2} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{String(d[x]).slice(5)}</text>}
      </g>)}
    </svg>
    {hover !== null ? <div className="small"><b>{data[hover][x]}</b> — {series.map((s) => `${s.label}: ${data[hover][s.key]}`).join('  ·  ')}</div> : <div className="small muted">Hover or tap the chart for details</div>}
    <div className="legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
  </div>);
}

export function HBars({ data, label, value, color = '#1e6bff' }: { data: any[]; label: string; value: string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[value]) || 0));
  return (<div>{data.length === 0 && <div className="muted small">No data yet</div>}{data.map((d, i) => (
    <div key={i} style={{ marginBottom: 9 }}>
      <div className="row between small"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{d[label]}</span><b>{Number(d[value]).toLocaleString()}</b></div>
      <div style={{ background: "var(--row-line)", borderRadius: 6, height: 8 }}><div style={{ width: `${(Number(d[value]) / max) * 100}%`, background: color, height: 8, borderRadius: 6 }} /></div>
    </div>))}</div>);
}
