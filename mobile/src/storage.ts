import * as SecureStore from 'expo-secure-store';

import type { ConnectionSettings } from './types';

const baseUrlKey = 'chapeaux.server.base-url';
const accessTokenKey = 'chapeaux.server.access-token';

export async function loadConnectionSettings(): Promise<ConnectionSettings | null> {
  const [baseUrl, accessToken] = await Promise.all([
    SecureStore.getItemAsync(baseUrlKey),
    SecureStore.getItemAsync(accessTokenKey),
  ]);
  return baseUrl && accessToken ? { baseUrl, accessToken } : null;
}

export async function saveConnectionSettings(settings: ConnectionSettings): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(baseUrlKey, settings.baseUrl),
    SecureStore.setItemAsync(accessTokenKey, settings.accessToken),
  ]);
}

export async function clearConnectionSettings(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(baseUrlKey),
    SecureStore.deleteItemAsync(accessTokenKey),
  ]);
}

