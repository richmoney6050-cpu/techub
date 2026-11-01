import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { get, money } from '../../src/api';
import { useSession } from '../../src/session';
import { Card, ErrorBox, Badge, s, C } from '../../src/ui';

export default function Home() {
  const { me } = useSession(); const sym = me!.currency_symbol; const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setD(await get('/dashboard')); setErr(null); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]));
  const Stat = ({ l, v, sub }: any) => <Card style={{ flex: 1, minWidth: '46%' }}><Text style={s.muted}>{l}</Text><Text style={{ fontSize: 20, fontWeight: '800', color: C.navy }}>{v}</Text>{sub && <Text style={s.muted}>{sub}</Text>}</Card>;
  return (<ScrollView style={s.screen} contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
    <Text style={s.h1}>Hello, {me!.name.split(' ')[0]}</Text><Text style={[s.muted, { marginBottom: 12 }]}>{me!.business_name}</Text><ErrorBox msg={err} />
    {d?.scope === 'owner' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Stat l="Sales today" v={money(d.cards.today, sym)} sub={`Week ${money(d.cards.week, sym)}`} /><Stat l="This month" v={money(d.cards.month, sym)} />
      <Stat l="Gross profit" v={money(d.cards.gross_profit, sym)} /><Stat l="Units in stock" v={d.cards.stock_units} sub={`${d.cards.products} products`} />
      <Stat l="Low stock" v={d.cards.low_stock} /><Stat l="Out of stock" v={d.cards.out_of_stock} /></View>}
    {d?.scope === 'employee' && d.my_today && <View style={{ flexDirection: 'row', gap: 10 }}><Stat l="My sales today" v={money(d.my_today.sales_total, sym)} /><Stat l="Sales made" v={d.my_today.sales_count} /></View>}
    {(d?.low_out_of_stock || d?.stock_alerts)?.length > 0 && <Card><Text style={s.h2}>Needs attention</Text>
      {(d.low_out_of_stock || d.stock_alerts).slice(0, 8).map((p: any, i: number) => <View key={i} style={[s.row, s.between, { paddingVertical: 6 }]}><Text style={{ flex: 1 }}>{p.name}</Text><Text style={{ marginHorizontal: 8, fontWeight: '700' }}>{p.quantity}</Text><Badge status={p.status} /></View>)}</Card>}
    {(d?.recent_sales || d?.my_recent_sales)?.length > 0 && <Card><Text style={s.h2}>Recent sales</Text>
      {(d.recent_sales || d.my_recent_sales).map((x: any) => <View key={x.id} style={[s.row, s.between, { paddingVertical: 6 }]}><Text>{x.receipt_no}</Text><Text style={{ fontWeight: '700' }}>{money(x.total, sym)}</Text></View>)}</Card>}
  </ScrollView>);
}
