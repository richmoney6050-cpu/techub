import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { get, money } from '@/api';
import { useSession } from '@/session';
import { Card, ErrorBox, Badge, Input, s } from '@/ui';

export default function Search() {
  const sym = useSession().me!.currency_symbol; const [q, setQ] = useState(''); const [items, setItems] = useState<any[]>([]); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { const r = await get(`/products?q=${encodeURIComponent(q)}&limit=60`); setItems(r.items); setMsg(r.message || null); setErr(null); } catch (e: any) { setErr(e.message); } }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useFocusEffect(useCallback(() => { const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]));
  return (<View style={s.screen}><View style={s.pad}><Input placeholder="Search name, brand, model, SKU…" value={q} onChangeText={setQ} autoCorrect={false} /><ErrorBox msg={err} />{msg && <Text style={{ marginTop: 10, color: '#7a5410' }}>{msg}</Text>}</View>
    <FlatList data={items} keyExtractor={(i) => i.variation_id} contentContainerStyle={{ padding: 14, paddingTop: 0 }} renderItem={({ item: p }) => <Card>
      <View style={[s.row, s.between]}><Text style={{ fontWeight: '700', flex: 1 }}>{p.name}{p.label ? ` (${p.label})` : ''}</Text><Text style={{ fontWeight: '800', fontSize: 16 }}>{money(p.selling_price, sym)}</Text></View>
      <View style={[s.row, s.between, { marginTop: 6 }]}><Text style={s.muted}>{[p.brand, p.model, p.sku].filter(Boolean).join(' · ')}</Text><View style={s.row}><Text style={{ marginRight: 8, fontWeight: '700' }}>{p.quantity} left</Text><Badge status={p.status} /></View></View></Card>} /></View>);
}
