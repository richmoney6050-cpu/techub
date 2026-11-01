import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/session';
import { C } from '../../src/ui';

const icon = (e: string) => ({ focused }: any) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{e}</Text>;
export default function TabsLayout() {
  const { can } = useSession();
  return (<Tabs screenOptions={{ headerStyle: { backgroundColor: C.navy }, headerTintColor: '#fff', tabBarActiveTintColor: C.blue }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('▦') }} />
    <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon('🔎'), href: can('products.view') ? undefined : null }} />
    <Tabs.Screen name="pos" options={{ title: 'Sell', tabBarIcon: icon('🛒'), href: can('sales.create') ? undefined : null }} />
    <Tabs.Screen name="alerts" options={{ title: 'Alerts', tabBarIcon: icon('🔔'), href: can('notifications.view') ? undefined : null }} />
    <Tabs.Screen name="more" options={{ title: 'Account', tabBarIcon: icon('👤') }} />
  </Tabs>);
}
