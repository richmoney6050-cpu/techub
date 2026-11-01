import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SessionProvider, useSession } from '@/session';

function Gate() {
  const { me, ready } = useSession(); const segs = useSegments(); const router = useRouter();
  useEffect(() => { if (!ready) return; const onLogin = segs[0] === 'login'; if (!me && !onLogin) router.replace('/login'); if (me && onLogin) router.replace('/'); }, [me, ready, segs]);
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;
  return <Stack screenOptions={{ headerShown: false }} />;
}
export default function Root() { return <SessionProvider><StatusBar style="dark" /><Gate /></SessionProvider>; }
