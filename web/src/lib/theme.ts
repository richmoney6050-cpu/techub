export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'techhub-theme';
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') { try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; } }
  return pref;
}
export function getStoredTheme(): ThemePref { try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch {} return 'system'; }
export function applyTheme(pref: ThemePref) {
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
  try { localStorage.setItem(KEY, pref); } catch {}
}
