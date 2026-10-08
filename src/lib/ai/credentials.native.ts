import * as SecureStore from 'expo-secure-store';
import { validateCredentials, type OnlineCredentials } from './online';

const KEY = 'pocket-ledger.online-ai.v1';
export async function readCredentials(): Promise<OnlineCredentials | null> {
  const value = await SecureStore.getItemAsync(KEY);
  return value ? validateCredentials(JSON.parse(value)) : null;
}
export async function saveCredentials(value: OnlineCredentials) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(validateCredentials(value)), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function clearCredentials() { await SecureStore.deleteItemAsync(KEY); }
