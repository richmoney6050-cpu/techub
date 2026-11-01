import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { get, post, money, uuid, ApiError } from '../../src/api';
import { useSession } from '../../src/session';
import { Button, Card, ErrorBox, Badge, Input, s, C } from '../../src/ui';

interface Line { id: string; name: string; price: number; qty: number; max: number }
const METHODS: [string, string][] = [['cash', 'Cash'], ['momo', 'MoMo'], ['bank_transfer', 'Bank'], ['card', 'Card']];

export default function POS() {
  const { me } = useSession(); const sym = me!.currency_symbol;
  const [q, setQ] = useState(''); const [items, setItems] = useState<any[]>([]); const [cart, setCart] = useState<Line[]>([]); const [method, setMethod] = useState('cash'); const [paid, setPaid] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState<any>(null);
  const [key, setKey] = useState(uuid()); // reused on retry so a dropped connection can never double-sell
  const [scan, setScan] = useState(false); const [perm, askPerm] = useCameraPermissions();

  const load = useCallback(async (term = q) => { try { const r = await get(`/products?q=${encodeURIComponent(term)}&limit=40`); setItems(r.items); } catch (e: any) { setErr(e.message); } }, [q]);
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t); }, [load]);

  const add = (p: any) => { if (p.quantity < 1) return; setCart((c) => { const i = c.findIndex((l) => l.id === p.variation_id); if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: Math.min(n[i].qty + 1, p.quantity), max: p.quantity }; return n; } return [...c, { id: p.variation_id, name: p.label ? `${p.name} (${p.label})` : p.name, price: p.selling_price, qty: 1, max: p.quantity }]; }); };
  const setQty = (id: string, d: number) => setCart((c) => c.flatMap((l) => l.id !== id ? [l] : l.qty + d < 1 ? [] : [{ ...l, qty: Math.min(l.max, l.qty + d) }]));
  const total = useMemo(() => Math.round(cart.reduce((t, l) => t + l.price * l.qty, 0) * 100) / 100, [cart]);
  const paidNum = paid === '' ? total : Number(paid) || 0; const change = Math.max(0, Math.round((paidNum - total) * 100) / 100);

  async function onScan(code: string) {
    setScan(false);
    try { const r = await get(`/products?q=${encodeURIComponent(code)}&limit=5`); const hit = r.items.find((p: any) => p.sku === code || p.barcode === code) || (r.items.length === 1 ? r.items[0] : null);
      if (hit) add(hit); else Alert.alert('Not found', 'Sorry, this product is currently not available in our inventory.'); } catch (e: any) { setErr(e.message); }
  }
  async function checkout() {
    setBusy(true); setErr(null);
    try {
      const r = await post('/sales', { idempotency_key: key, items: cart.map((l) => ({ variation_id: l.id, quantity: l.qty })), payment_method: method, amount_paid: paidNum });
      setDone(r.sale); setCart([]); setPaid(''); setKey(uuid()); load();
    } catch (e: any) { setErr(e instanceof ApiError && e.code === 'insufficient_stock' ? e.message + ' Please reduce the quantity.' : e.message); if (e.code === 'insufficient_stock') load(); }
    finally { setBusy(false); }
  }
  return (<View style={s.screen}>
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { gap: 8 }]}><View style={{ flex: 1 }}><Input placeholder="Search products…" value={q} onChangeText={setQ} autoCorrect={false} /></View>
        <Pressable onPress={async () => { if (!perm?.granted) { const r = await askPerm(); if (!r.granted) return; } setScan(true); }} style={[s.btn, { paddingHorizontal: 14 }]} accessibilityLabel="Scan barcode"><Text style={s.btnText}>▮▯▮</Text></Pressable></View>
      <View style={{ marginTop: 10 }}>{items.map((p) => <Pressable key={p.variation_id} onPress={() => add(p)} disabled={p.quantity < 1} style={{ opacity: p.quantity < 1 ? 0.45 : 1 }}>
        <Card style={{ marginBottom: 8, padding: 12 }}><View style={[s.row, s.between]}><Text style={{ flex: 1, fontWeight: '600' }}>{p.name}{p.label ? ` (${p.label})` : ''}</Text><Text style={{ fontWeight: '800' }}>{money(p.selling_price, sym)}</Text></View>
          <View style={[s.row, s.between, { marginTop: 4 }]}><Text style={s.muted}>{p.quantity} available</Text><Badge status={p.status} /></View></Card></Pressable>)}</View>
    </ScrollView>
    <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.line, padding: 14, maxHeight: '55%' }}>
      <ScrollView>{cart.length === 0 ? <Text style={s.muted}>Tap products to add them to the sale</Text> : cart.map((l) => <View key={l.id} style={[s.row, s.between, { paddingVertical: 5 }]}>
        <Text style={{ flex: 1 }} numberOfLines={1}>{l.name}</Text>
        <View style={s.row}><Pressable onPress={() => setQty(l.id, -1)} style={{ padding: 8 }}><Text style={{ fontSize: 22 }}>−</Text></Pressable><Text style={{ minWidth: 24, textAlign: 'center', fontWeight: '700' }}>{l.qty}</Text><Pressable onPress={() => setQty(l.id, 1)} style={{ padding: 8 }}><Text style={{ fontSize: 22 }}>+</Text></Pressable></View>
        <Text style={{ width: 84, textAlign: 'right', fontWeight: '700' }}>{money(l.price * l.qty, sym)}</Text></View>)}</ScrollView>
      {cart.length > 0 && <>
        <View style={[s.row, { gap: 6, marginVertical: 8 }]}>{METHODS.map(([k, l]) => <Pressable key={k} onPress={() => setMethod(k)} style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: method === k ? C.blue : C.line, backgroundColor: method === k ? '#e8f0ff' : '#fff', alignItems: 'center' }}><Text style={{ fontWeight: '600' }}>{l}</Text></Pressable>)}</View>
        <View style={[s.row, { gap: 10, marginBottom: 8 }]}><View style={{ flex: 1 }}><Input placeholder={`Paid (${total})`} keyboardType="decimal-pad" value={paid} onChangeText={setPaid} /></View>{change > 0 && <Text style={{ fontWeight: '800', color: C.ok }}>Change {money(change, sym)}</Text>}</View>
        <ErrorBox msg={err} /><Button title={`Complete sale · ${money(total, sym)}`} onPress={checkout} busy={busy} /></>}
      {cart.length === 0 && <ErrorBox msg={err} />}
    </View>
    <Modal visible={scan} animationType="slide" onRequestClose={() => setScan(false)}><View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'code39', 'qr'] }} onBarcodeScanned={({ data }) => onScan(data)} />
      <View style={{ padding: 16 }}><Button title="Cancel" secondary onPress={() => setScan(false)} /></View></View></Modal>
    <Modal visible={!!done} transparent animationType="fade" onRequestClose={() => setDone(null)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'center', padding: 20 }}>
      {done && <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20 }}><Text style={{ fontSize: 20, fontWeight: '800', color: C.ok }}>Sale complete ✔</Text><Text style={{ marginTop: 6 }}>{done.receipt_no}</Text>
        {done.items.map((i: any) => <View key={i.id} style={[s.row, s.between, { marginTop: 6 }]}><Text style={{ flex: 1 }}>{i.quantity} × {i.name}</Text><Text>{money(i.line_total, sym)}</Text></View>)}
        <Text style={{ fontSize: 22, fontWeight: '800', marginTop: 12 }}>Total {money(done.total, sym)}</Text>{done.change_due > 0 && <Text style={{ color: C.ok, fontWeight: '700', marginTop: 4 }}>Give change: {money(done.change_due, sym)}</Text>}
        <Text style={[s.muted, { marginTop: 8 }]}>Open this receipt on the website to print or save as PDF.</Text><View style={{ height: 12 }} /><Button title="New sale" onPress={() => setDone(null)} /></View>}
    </View></Modal>
  </View>);
}
