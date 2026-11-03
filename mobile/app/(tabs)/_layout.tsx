import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSession } from '../../src/session';
import { C } from '../../src/ui';

const icon = (e: string) => ({ focused }: any) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{e}</Text>;
export default function TabsLayout() {
  const { can, me, ready } = useSession();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#f3f5f9' }}><ActivityIndicator size="large" /></View>;
  if (!me) return <Redirect href="/login" />;
  return (<Tabs screenOptions={{ headerStyle: { backgroundColor: C.navy }, headerTintColor: '#fff', tabBarActiveTintColor: C.blue }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('▦') }} />
    <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon('🔎'), href: can('products.view') ? undefined : null }} />
    <Tabs.Screen name="pos" options={{ title: 'Sell', tabBarIcon: icon('🛒'), href: can('sales.create') ? undefined : null }} />
    <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: icon('🧑'), href: can('customers.manage') ? undefined : null }} />
    <Tabs.Screen name="warranty" options={{ title: 'Warranty', tabBarIcon: icon('🛡'), href: can('warranty.manage') ? undefined : null }} />
    <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: icon('🔔'), href: can('notifications.view') ? undefined : null }} />
    <Tabs.Screen name="more" options={{ title: 'Account', tabBarIcon: icon('👤') }} />
  </Tabs>);
}
