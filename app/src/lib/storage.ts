import * as SecureStore from 'expo-secure-store';

export interface HostConfig {
  host: string;
  port: number;
  tls: boolean;
  token: string;
}

const KEY = 'lumen.host';

export async function loadHost(): Promise<HostConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as HostConfig) : null;
  } catch {
    return null;
  }
}

export const saveHost = (h: HostConfig) => SecureStore.setItemAsync(KEY, JSON.stringify(h));