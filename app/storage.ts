import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';

type KV = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
};

let storage: KV;

try {
  // try MMKV first
  const mmkv = new MMKV();
  storage = {
    getString: (k) => mmkv.getString(k),
    set: (k, v) => mmkv.set(k, v),
    delete: (k) => mmkv.delete(k),
  };
  console.log('Storage: MMKV actief');
} catch (e) {
  // Fallback to  AsyncStorage
  console.log('MMKV init failed → fallback naar AsyncStorage', String(e));
  storage = {
    getString: (k) => {
      // AsyncStorage is async → maar we geven sync-achtige wrapper terug
      // => let op: initial load moet via getJSONAsync
      console.warn('Gebruik getJSONAsync voor AsyncStorage keys');
      return undefined;
    },
    set: (k, v) => { AsyncStorage.setItem(k, v); },
    delete: (k) => { AsyncStorage.removeItem(k); },
  };
}

// Synchronous helpers (are working only when MMKV is active)
export const getItem = (k: string) => storage.getString(k) ?? null;
export const setItem = (k: string, v: string) => storage.set(k, v);
export const removeItem = (k: string) => storage.delete(k);

// JSON helpers
export function getJSON<T>(k: string): T | null {
  const s = getItem(k);
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}
export function setJSON<T>(k: string, v: T) {
  setItem(k, JSON.stringify(v));
}

// extremely useful async JSON getter for AsyncStorage fallback
export async function getJSONAsync<T>(k: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}