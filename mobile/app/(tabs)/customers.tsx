import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { get, money } from '../../src/api';
import { useSession } from '../../src/session';
import { Card, ErrorBox, Input, s } from '../../src/ui';

export default function Customers() {
  const sym = useSession().me!.currency_symbol; const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { const r = await get(`/customers?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`); setRows(r.customers); setErr(null); } catch (e: any) { setErr(e.message); } }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  return (<View style={s.screen}><View style={s.pad}><Input placeholder="Search name or phone…" value={q} onChangeText={setQ} autoCorrect={false} /><ErrorBox msg={err} /></View>
    <FlatList data={rows} keyExtractor={(i) => i.id} contentContainerStyle={{ padding: 14, paddingTop: 0 }} ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', marginTop: 30 }]}>No customers found</Text>}
      renderItem={({ item: c }) => <Card>
        <View style={[s.row, s.between]}><Text style={{ fontWeight: '700', flex: 1 }}>{c.name}</Text>{c.outstanding > 0 && <Text style={{ fontWeight: '800', color: '#b45309' }}>Owes {money(c.outstanding, sym)}</Text>}</View>
        <Text style={s.muted}>{[c.phone, `${c.purchases} purchases`, `Spent ${money(c.total_spent, sym)}`].filter(Boolean).join(' · ')}</Text></Card>} /></View>);
}
