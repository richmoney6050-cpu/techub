'use client';
import { createContext, useContext } from 'react';
export interface Me {
  id: string; name: string; username: string; role: 'owner' | 'employee'; permissions: string[];
  business_name: string; logo_url: string | null; currency_symbol: string; theme?: 'light' | 'dark' | 'system';
}
export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;
export const useCan = () => { const me = useMe(); return (p: string) => me.permissions.includes(p); };
