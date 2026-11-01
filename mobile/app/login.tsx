import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../src/session';
import { Button, Input, ErrorBox, C } from '../src/ui';

export default function Login() {
  const { login } = useSession(); const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function go() { setBusy(true); setErr(null); try { await login(u.trim(), p); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  return (<SafeAreaView style={{ flex: 1, backgroundColor: C.navy }}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 22 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: C.navy }}>TECH<Text style={{ color: C.blue }}>HUB</Text></Text>
        <Text style={{ color: C.muted, marginBottom: 16 }}>Sign in to your shop</Text><ErrorBox msg={err} />
        <Input placeholder="Username" autoCapitalize="none" autoCorrect={false} value={u} onChangeText={setU} style={{ marginBottom: 10 }} />
        <Input placeholder="Password" secureTextEntry value={p} onChangeText={setP} onSubmitEditing={go} style={{ marginBottom: 14 }} />
        <Button title="Sign in" onPress={go} busy={busy} disabled={!u || !p} />
        <Text style={{ color: C.muted, fontSize: 12, marginTop: 14, textAlign: 'center' }}>Business owners create their account on the TECHHUB website.</Text>
      </View></ScrollView></KeyboardAvoidingView></SafeAreaView>);
}
