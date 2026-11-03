import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { get } from '../../src/api';
import { Card, ErrorBox, Input, s } from '../../src/ui';

const COLORS: Record<string, string> = { active: '#16a34a', expired: '#64748b', under_review: '#b45309', claimed: '#176bff', completed: '#64748b' };
export default function Warranty() {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { const r = await get(`/warranties?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`); setRows(r.warranties); setErr(null); } catch (e: any) { setErr(e.message); } }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  return (<View style={s.screen}><View style={s.pad}><Input placeholder="Serial number, IMEI, product or customer…" value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" /><ErrorBox msg={err} /></View>
    <FlatList data={rows} keyExtractor={(i) => i.id} contentContainerStyle={{ padding: 14, paddingTop: 0 }} ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', marginTop: 30 }]}>No warranties found</Text>}
      renderItem={({ item: w }) => <Card>
        <View style={[s.row, s.between]}><Text style={{ fontWeight: '700', flex: 1 }}>{w.product_name}</Text><Text style={{ fontWeight: '800', color: COLORS[w.status] || '#64748b' }}>{String(w.status).replace('_', ' ')}</Text></View>
        <Text style={s.muted}>{[w.serial_number && `S/N ${w.serial_number}`, w.imei && `IMEI ${w.imei}`].filter(Boolean).join(' · ')}</Text>
        <Text style={s.muted}>Ends {w.end_date}{w.customer_name ? ` · ${w.customer_name}` : ''}</Text></Card>} /></View>);
}
