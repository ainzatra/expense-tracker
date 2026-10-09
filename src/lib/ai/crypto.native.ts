import { getRandomValues, randomUUID } from 'expo-crypto';

export function ensureCrypto() {
  if (
    typeof globalThis.crypto?.randomUUID === 'function' &&
    typeof globalThis.crypto?.getRandomValues === 'function'
  )
    return;
  const value = Object.create(globalThis.crypto ?? null);
  Object.assign(value, { getRandomValues, randomUUID });
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true });
}
