import * as SecureStore from 'expo-secure-store';
import { validateAuth, type OnlineCredentials } from './online';

const LEGACY_KEY = 'pocket-ledger.online-ai.v1';
const KEY = 'pocket-ledger.api-key.v2';
export async function readCredentials(): Promise<OnlineCredentials | null> {
  const current = await SecureStore.getItemAsync(KEY);
  if (current) return { ...validateAuth(JSON.parse(current)), model: '' };
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
  if (!legacy) return null;
  const value = JSON.parse(legacy);
  return { ...validateAuth(value), model: typeof value.model === 'string' ? value.model : '' };
}
export async function saveCredentials(value: OnlineCredentials) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(validateAuth(value)), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  await SecureStore.deleteItemAsync(LEGACY_KEY);
}
export async function clearCredentials() { await SecureStore.deleteItemAsync(KEY); await SecureStore.deleteItemAsync(LEGACY_KEY); }
