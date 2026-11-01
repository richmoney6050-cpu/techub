import { ScrollView, Text } from 'react-native';
import { useSession } from '@/session';
import { API_URL } from '@/api';
import { Button, Card, s } from '@/ui';

export default function More() {
  const { me, logout } = useSession();
  return (<ScrollView style={s.screen} contentContainerStyle={s.pad}><Card><Text style={s.h2}>{me!.name}</Text><Text style={s.muted}>{me!.role === 'owner' ? 'Business owner' : 'Employee'} · {me!.business_name}</Text></Card>
    <Card><Text style={s.muted}>Products, reports, employees and settings are managed on the TECHHUB website. Everything stays in sync with this app.</Text><Text style={[s.muted, { marginTop: 8 }]}>Server: {API_URL || 'not configured'}</Text></Card>
    <Button title="Sign out" onPress={logout} secondary /></ScrollView>);
}
