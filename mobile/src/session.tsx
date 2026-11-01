import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { get, post, loadToken, saveToken, setOnAuthLost } from './api';

export interface Me { id: string; name: string; role: 'owner' | 'employee'; permissions: string[]; business_name: string; currency_symbol: string }
interface Ctx { me: Me | null; ready: boolean; login: (u: string, p: string) => Promise<void>; logout: () => Promise<void>; can: (p: string) => boolean }
const C = createContext<Ctx>(null as any);
export const useSession = () => useContext(C);

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }) });

async function registerPush() {
  try {
    if (!Device.isDevice) return;
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await post('/auth/push-token', { token: t.data, platform: Platform.OS });
  } catch { /* push is optional */ }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [ready, setReady] = useState(false);
  const fetchMe = useCallback(async () => { const r = await get('/auth/me'); setMe(r.user); registerPush(); }, []);
  useEffect(() => { setOnAuthLost(() => setMe(null)); (async () => { try { if (await loadToken()) await fetchMe(); } catch { /* offline: stay on login */ } setReady(true); })(); }, []);
  const login = async (username: string, password: string) => { const r = await post('/auth/login', { username, password, device: Platform.OS }); await saveToken(r.token); await fetchMe(); };
  const logout = async () => { try { await post('/auth/logout'); } catch {} await saveToken(null); setMe(null); };
  return <C.Provider value={{ me, ready, login, logout, can: (p) => !!me?.permissions.includes(p) }}>{children}</C.Provider>;
}
