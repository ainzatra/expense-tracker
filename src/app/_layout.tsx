import '../../global.css';
import { Suspense } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DataProvider } from '@/data/provider';
import { migrate } from '@/data/schema';
import { AiProvider } from '@/lib/ai/provider';
export { ErrorBoundary } from 'expo-router';

export default function Layout() {
  return <SafeAreaProvider>
    <StatusBar style="dark" />
    <Suspense fallback={<View className="flex-1 items-center justify-center bg-background"><ActivityIndicator color="#176b50" /></View>}>
      <SQLiteProvider databaseName="pocket-ledger.db" onInit={migrate} useSuspense>
        <DataProvider><AiProvider><Stack screenOptions={{ headerShown: false }} /></AiProvider></DataProvider>
      </SQLiteProvider>
    </Suspense>
  </SafeAreaProvider>;
}
