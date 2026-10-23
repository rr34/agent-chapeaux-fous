import * as SecureStore from 'expo-secure-store';

import { productionServerUrl } from './config';
import type { ConnectionSettings } from './types';

const obsoleteBaseUrlKey = 'time-v3-technology-agent.server.base-url';
const accessTokenKey = 'time-v3-technology-agent.server.access-token';
const legacyBaseUrlKey = 'chapeaux.server.base-url';
const legacyAccessTokenKey = 'chapeaux.server.access-token';

export async function loadConnectionSettings(): Promise<ConnectionSettings | null> {
  const accessToken = await SecureStore.getItemAsync(accessTokenKey);
  if (accessToken) return { baseUrl: productionServerUrl, accessToken };

  const legacyAccessToken = await SecureStore.getItemAsync(legacyAccessTokenKey);
  if (!legacyAccessToken) return null;

  const settings = { baseUrl: productionServerUrl, accessToken: legacyAccessToken };
  await saveConnectionSettings(settings);
  await Promise.all([
    SecureStore.deleteItemAsync(obsoleteBaseUrlKey),
    SecureStore.deleteItemAsync(legacyBaseUrlKey),
    SecureStore.deleteItemAsync(legacyAccessTokenKey),
  ]);
  return settings;
}

export async function saveConnectionSettings({ accessToken }: ConnectionSettings): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(accessTokenKey, accessToken),
    SecureStore.deleteItemAsync(obsoleteBaseUrlKey),
    SecureStore.deleteItemAsync(legacyBaseUrlKey),
    SecureStore.deleteItemAsync(legacyAccessTokenKey),
  ]);
}

export async function clearConnectionSettings(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(accessTokenKey),
    SecureStore.deleteItemAsync(obsoleteBaseUrlKey),
    SecureStore.deleteItemAsync(legacyBaseUrlKey),
    SecureStore.deleteItemAsync(legacyAccessTokenKey),
  ]);
}

