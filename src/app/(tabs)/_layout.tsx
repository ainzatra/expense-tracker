import { Tabs } from 'expo-router';
import { House, ReceiptText, Wallet, Sparkles, Settings } from 'lucide-react-native';
export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#176b50', tabBarInactiveTintColor: '#77847c', tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#dedfd6' }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
    <Tabs.Screen name="expenses" options={{ title: 'Activity', tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} /> }} />
    <Tabs.Screen name="wallets" options={{ title: 'Wallets', tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} /> }} />
    <Tabs.Screen name="assistant" options={{ title: 'Assistant', tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
  </Tabs>;
}
