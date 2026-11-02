'use client';
import { useEffect, useState } from 'react';
import { put } from '@/lib/api';
import { applyTheme, getStoredTheme, ThemePref } from '@/lib/theme';

/** Light / Dark / Auto switch. Saved in the browser immediately and on the user's account (when signed in). */
export default function ThemeSwitch({ initial, save = true }: { initial?: ThemePref; save?: boolean }) {
  const [pref, setPref] = useState<ThemePref>('system');
  useEffect(() => { const p = initial ?? getStoredTheme(); setPref(p); applyTheme(p); }, [initial]);
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); const on = () => applyTheme('system');
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, [pref]);
  function choose(p: ThemePref) { setPref(p); applyTheme(p); if (save) put('/auth/preferences', { theme: p }).catch(() => {}); }
  const opts: [ThemePref, string][] = [['light', '☀ Light'], ['dark', '🌙 Dark'], ['system', 'Auto']];
  return (<div className="theme-switch" role="group" aria-label="Colour theme">{opts.map(([v, l]) => <button key={v} type="button" className={pref === v ? 'on' : ''} aria-pressed={pref === v} onClick={() => choose(v)}>{l}</button>)}</div>);
}
