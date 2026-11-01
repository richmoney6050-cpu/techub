import { useCallback, useState } from 'react';
import { FlatList, Text, View, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { get, post } from '../../src/api';
import { Button, Card, ErrorBox, s, C } from '../../src/ui';

const COLOR: any = { low_stock: C.warn, out_of_stock: C.bad, restocked: C.ok, system: C.blue };
export default function Alerts() {
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setRows((await get('/notifications')).notifications); setErr(null); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]));
  return (<View style={s.screen}><View style={s.pad}><ErrorBox msg={err} /><Button title="Mark all as read" secondary onPress={async () => { await post('/notifications/read-all'); load(); }} /></View>
    <FlatList data={rows} keyExtractor={(r) => r.id} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />} contentContainerStyle={{ padding: 14, paddingTop: 0 }} ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', marginTop: 30 }]}>No alerts yet</Text>}
      renderItem={({ item: r }) => <Card style={{ borderLeftWidth: 5, borderLeftColor: COLOR[r.type], opacity: r.resolved ? 0.6 : 1 }}><Text style={{ fontWeight: r.is_read ? '400' : '700' }}>{r.message}</Text><Text style={s.muted}>{new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Accra' })}{r.resolved ? ' · resolved' : ''}</Text></Card>} /></View>);
}
