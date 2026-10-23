import * as SecureStore from 'expo-secure-store';

import type { CorrespondenceCursor } from '../modules/time-v3-native/src/TimeV3NativeModule';
import { productionServerUrl } from './config';
import type { ConnectionSettings } from './types';

const obsoleteBaseUrlKey = 'time-v3-technology-agent.server.base-url';
const accessTokenKey = 'time-v3-technology-agent.server.access-token';
const legacyBaseUrlKey = 'chapeaux.server.base-url';
const legacyAccessTokenKey = 'chapeaux.server.access-token';
const correspondenceCursorKey = 'time-v3-technology-agent.correspondence-cursor.v1';

export const emptyCorrespondenceCursor: CorrespondenceCursor = Object.freeze({
  contactsUpdatedAtMs: 0,
  contactsId: 0,
  callsAtMs: 0,
  callsId: 0,
  smsAtMs: 0,
  smsId: 0,
  mmsAtMs: 0,
  mmsId: 0,
});

const cursorFields = Object.keys(emptyCorrespondenceCursor) as Array<keyof CorrespondenceCursor>;

export async function loadCorrespondenceCursor(): Promise<CorrespondenceCursor> {
  const encoded = await SecureStore.getItemAsync(correspondenceCursorKey);
  if (!encoded) return { ...emptyCorrespondenceCursor };
  try {
    const parsed = JSON.parse(encoded) as Partial<CorrespondenceCursor>;
    const cursor = { ...emptyCorrespondenceCursor };
    for (const field of cursorFields) {
      const value = parsed[field];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid correspondence cursor field: ${field}`);
      }
      cursor[field] = value;
    }
    return cursor;
  } catch {
    throw new Error('The saved phone synchronization cursor is invalid. Reinstall the app or reset its storage before synchronizing.');
  }
}

export async function saveCorrespondenceCursor(cursor: CorrespondenceCursor): Promise<void> {
  await SecureStore.setItemAsync(correspondenceCursorKey, JSON.stringify(cursor));
}

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

