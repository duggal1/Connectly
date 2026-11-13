import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { HostConfig } from './storage';

export const MAX_TABS = 5;

export interface Tab {
  key: string;
  session?: string;
  remoteId?: string;
  remoteName?: string;
}

export type Pane =
  | { kind: 'sessions' }
  | { kind: 'mac' }
  | { kind: 'screen' }
  | { kind: 'tab'; key: string };

export interface TabsState {
  tabs: Tab[];
  pane: Pane;
}

export type TabAction =
  | { type: 'load'; state: TabsState }
  | { type: 'show'; pane: Pane }
  | { type: 'open'; key: string; session?: string }
  | { type: 'openRemote'; key: string; remoteId: string; remoteName: string }
  | { type: 'bind'; key: string; session: string }
  | { type: 'close'; key: string }
  | { type: 'closeSession'; session: string }
  | { type: 'closeRemote'; remoteId: string }
  | { type: 'restart'; key: string; next: string };

export const newKey = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const INITIAL: TabsState = { tabs: [], pane: { kind: 'sessions' } };

function remove(state: TabsState, drop: (tab: Tab) => boolean): TabsState {
  const tabs = state.tabs.filter((tab) => !drop(tab));
  if (tabs.length === state.tabs.length) return state;
  const activeKey = state.pane.kind === 'tab' ? state.pane.key : null;
  if (activeKey === null || tabs.some((tab) => tab.key === activeKey)) {
    return { tabs, pane: state.pane };
  }

  const index = state.tabs.findIndex((tab) => tab.key === activeKey);
  const remaining = (tab: Tab) => !drop(tab);
  const next = state.tabs.slice(index + 1).find(remaining) ?? state.tabs.slice(0, index).reverse().find(remaining);
  return { tabs, pane: next ? { kind: 'tab', key: next.key } : { kind: 'sessions' } };
}

export function tabsReducer(state: TabsState, action: TabAction): TabsState {
  switch (action.type) {
    case 'load':
      return action.state;
    case 'show':
      return { ...state, pane: action.pane };
    case 'open': {
      const existing = action.session ? state.tabs.find((tab) => tab.session === action.session) : undefined;
      if (existing) return { ...state, pane: { kind: 'tab', key: existing.key } };
      const tabs = [...state.tabs, { key: action.key, session: action.session }];
      while (tabs.length > MAX_TABS) tabs.shift();
      return { tabs, pane: { kind: 'tab', key: action.key } };
    }
    case 'openRemote': {
      const existing = state.tabs.find((tab) => tab.remoteId === action.remoteId);
      if (existing) {
        return {
          tabs: state.tabs.map((tab) => tab.key === existing.key ? { ...tab, remoteName: action.remoteName } : tab),
          pane: { kind: 'tab', key: existing.key },
        };
      }
      const tabs = [...state.tabs, { key: action.key, remoteId: action.remoteId, remoteName: action.remoteName }];
      while (tabs.length > MAX_TABS) tabs.shift();
      return { tabs, pane: { kind: 'tab', key: action.key } };
    }
    case 'bind':
      if (!state.tabs.some((tab) => tab.key === action.key && tab.session !== action.session)) return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) => tab.key === action.key ? { ...tab, session: action.session } : tab),
      };
    case 'close':
      return remove(state, (tab) => tab.key === action.key);
    case 'closeSession':
      return remove(state, (tab) => tab.session === action.session);
    case 'closeRemote':
      return remove(state, (tab) => tab.remoteId === action.remoteId);
    case 'restart':
      if (!state.tabs.some((tab) => tab.key === action.key)) return state;
      return {
        tabs: state.tabs.map((tab) => tab.key === action.key ? { key: action.next } : tab),
        pane: state.pane.kind === 'tab' && state.pane.key === action.key
          ? { kind: 'tab', key: action.next }
          : state.pane,
      };
  }
}

interface SavedTabs {
  tabs: { key: string; session?: string; remoteId?: string; remoteName?: string }[];
  active?: string;
}

interface StoredState {
  key: string;
  ready: boolean;
  state: TabsState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function storeKey(cfg: HostConfig): string {
  const source = `${cfg.host}:${cfg.port}:${cfg.tls ? 'tls' : 'plain'}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `connectly.tabs.${(hash >>> 0).toString(36)}`;
}

function parseSaved(raw: string): SavedTabs | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isArray(value.tabs)) return null;
    const tabs: SavedTabs['tabs'] = [];
    for (const entry of value.tabs) {
      if (!isRecord(entry) || typeof entry.key !== 'string') return null;
      if (typeof entry.session === 'string') {
        tabs.push({ key: entry.key, session: entry.session });
      } else if (typeof entry.remoteId === 'string') {
        tabs.push({
          key: entry.key,
          remoteId: entry.remoteId,
          remoteName: typeof entry.remoteName === 'string' ? entry.remoteName : entry.remoteId,
        });
      } else {
        return null;
      }
    }
    return {
      tabs,
      active: typeof value.active === 'string' ? value.active : undefined,
    };
  } catch {
    return null;
  }
}

async function loadState(key: string): Promise<TabsState> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    const saved = raw ? parseSaved(raw) : null;
    if (!saved) return INITIAL;
    const tabs = saved.tabs.slice(0, MAX_TABS);
    const active = tabs.find((tab) => tab.key === saved.active);
    return { tabs, pane: active ? { kind: 'tab', key: active.key } : { kind: 'sessions' } };
  } catch {
    return INITIAL;
  }
}

function serializeState(state: TabsState): string {
  const tabs = state.tabs.filter((tab) => Boolean(tab.session || tab.remoteId));
  const activeKey = state.pane.kind === 'tab' ? state.pane.key : undefined;
  const active = activeKey && tabs.some((tab) => tab.key === activeKey)
    ? activeKey
    : undefined;
  const saved: SavedTabs = { tabs, active };
  return JSON.stringify(saved);
}

export function useTabs(cfg: HostConfig): [TabsState, Dispatch<TabAction>, boolean] {
  const key = storeKey(cfg);
  const [stored, setStored] = useState<StoredState>({ key, ready: false, state: INITIAL });
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    setStored({ key, ready: false, state: INITIAL });
    void loadState(key).then((state) => {
      if (active) setStored({ key, ready: true, state });
    });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (stored.key !== key || !stored.ready) return;
    const serialized = serializeState(stored.state);
    writes.current = writes.current
      .catch(() => {})
      .then(() => SecureStore.setItemAsync(key, serialized))
      .catch(() => {});
  }, [key, stored]);

  const dispatch = useCallback<Dispatch<TabAction>>((action) => {
    setStored((current) => current.key === key && current.ready
      ? { ...current, state: tabsReducer(current.state, action) }
      : current);
  }, [key]);

  const current = stored.key === key ? stored : { key, ready: false, state: INITIAL };
  return [current.state, dispatch, current.ready];
}
