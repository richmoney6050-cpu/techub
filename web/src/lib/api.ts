'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number; code?: string; details?: any;
  constructor(status: number, message: string, code?: string, details?: any) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No internet connection. Your last action was NOT saved. Please check your connection and try again.', 'offline');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) { window.location.href = '/login'; }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong', data.code, data.details);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: any) => api<T>('POST', p, b ?? {});
export const put = <T = any>(p: string, b?: any) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/** Loads data and (optionally) refreshes it every few seconds so every device stays in sync. */
export function useApi<T = any>(path: string | null, opts: { interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try { const d = await get<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e: any) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => {
    alive.current = true; setLoading(true); load();
    let t: any;
    if (opts.interval) {
      t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, opts.interval);
    }
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, opts.interval]);
  return { data, error, loading, reload: load, setData };
}

export const money = (n: any, sym = 'GH₵') => `${sym}${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const num = (n: any) => Number(n || 0).toLocaleString('en-GH');
export const dt = (s: string) => new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra' });
export const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
export const METHOD: Record<string, string> = { cash: 'Cash', momo: 'Mobile Money', bank_transfer: 'Bank transfer', card: 'Card' };
