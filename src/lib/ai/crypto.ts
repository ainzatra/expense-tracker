export function ensureCrypto() {
  if (!globalThis.crypto?.getRandomValues)
    throw new Error(
      'Secure random generation is unavailable in this browser. Use HTTPS or the Android app.',
    );
}
