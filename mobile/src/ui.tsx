import { ReactNode } from 'react';
import { Text, View, Pressable, StyleSheet, TextInput, ActivityIndicator, TextInputProps } from 'react-native';

export const C = { navy: '#0b1220', blue: '#176bff', bg: '#f3f5f9', line: '#e1e6ef', muted: '#5d6b82', ok: '#0f9d58', warn: '#b7791f', bad: '#d93025' };
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg }, pad: { padding: 14 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.line, marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: '800', color: C.navy }, h2: { fontSize: 16, fontWeight: '700', color: C.navy, marginBottom: 8 },
  muted: { color: C.muted, fontSize: 13 }, row: { flexDirection: 'row', alignItems: 'center' }, between: { justifyContent: 'space-between' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cdd5e3', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  btn: { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
export const Button = ({ title, onPress, disabled, secondary, danger, busy }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean; busy?: boolean }) => (
  <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy} style={[s.btn, secondary && { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line }, danger && { backgroundColor: C.bad }, (disabled || busy) && { opacity: 0.5 }]}>
    {busy ? <ActivityIndicator color={secondary ? C.navy : '#fff'} /> : <Text style={[s.btnText, secondary && { color: C.navy }]}>{title}</Text>}
  </Pressable>);
export const Input = (p: TextInputProps) => <TextInput placeholderTextColor="#8a96aa" {...p} style={[s.input, p.style]} />;
export const Card = ({ children, style }: { children: ReactNode; style?: any }) => <View style={[s.card, style]}>{children}</View>;
export const ErrorBox = ({ msg }: { msg?: string | null }) => msg ? <View style={{ backgroundColor: '#fde8e6', padding: 12, borderRadius: 10, marginBottom: 10 }}><Text style={{ color: '#9b1c13' }}>{msg}</Text></View> : null;
export function Badge({ status }: { status: string }) {
  const m: any = { in_stock: ['#e3f6ec', C.ok, 'IN STOCK'], low_stock: ['#fff4d6', C.warn, 'LOW STOCK'], out_of_stock: ['#fde8e6', C.bad, 'OUT OF STOCK'] };
  const [bg, fg, label] = m[status] || ['#eceff5', C.muted, status];
  return <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 }}><Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{label}</Text></View>;
}
