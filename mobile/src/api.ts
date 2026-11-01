import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra as any)?.apiUrl || '').replace(/\/$/, '');
const KEY = 'techhub_token';
let token: string | null = null;
let onAuthLost: (() => void) | null = null;
export const setOnAuthLost = (fn: () => void) => { onAuthLost = fn; };
export async function loadToken() { token = await SecureStore.getItemAsync(KEY); return token; }
export async function saveToken(t: string | null) { token = t; if (t) await SecureStore.setItemAsync(KEY, t); else await SecureStore.deleteItemAsync(KEY); }

export class ApiError extends Error { status: number; code?: string; constructor(s: number, m: string, c?: string) { super(m); this.status = s; this.code = c; } }

export async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, 'No internet connection. Nothing was saved. Please try again.', 'offline'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) { await saveToken(null); onAuthLost?.(); }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong', data.code);
  return data;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: any) => api<T>('POST', p, b ?? {});

export const money = (n: any, sym = 'GH₵') => `${sym}${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
