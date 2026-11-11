import { useCallback, useEffect, useState } from 'react';
import type { Dispatch } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { HostConfig } from './storage';

export const MAX_TABS = 5;

export interface Tab {
  key: string;
  session?: string;
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
  | { type: 'bind'; key: string; session: string }
  | { type: 'close'; key: string }
  | { type: 'closeSession'; session: string }
  | { type: 'restart'; key: string; next: string };

export const newKey = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const INITIAL: TabsState = { tabs: [], pane: { kind: 'sessions' } };

function remove(state: TabsState, drop: (tab: Tab) => boolean): TabsState {
  const tabs = state.tabs.filter((tab) => !drop(tab));
  if (tabs.length === state.tabs.length) return state;
  if (state.pane.kind !== 'tab' || tabs.some((tab) => tab.key === state.pane.key)) {
    return { tabs, pane: state.pane };
  }

  const index = state.tabs.findIndex((tab) => tab.key === state.pane.key);
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
    case 'bind':
      return {
        ...state,
        tabs: state.tabs.map((tab) => tab.key === action.key ? { ...tab, session: action.session } : tab),
      };
    case 'close':
      return remove(state, (tab) => tab.key === action.key);
    case 'closeSession':
      return remove(state, (tab) => tab.session === action.session);
    case 'restart':
      return {
        tabs: state.tabs.map((tab) => tab.key === action.key ? { key: action.next } : tab),
        pane: state.pane.kind === 'tab' && state.pane.key === action.key
          ? { kind: 'tab', key: action.next }
          : state.pane,
      };
  }
}

interface SavedTabs {
  tabs: { key: string; session: string }[];
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
    if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
    const tabs: SavedTabs['tabs'] = [];
    for (const entry of value.tabs) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.session !== 'string') return null;
      tabs.push({ key: entry.key, session: entry.session });
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

async function saveState(key: string, state: TabsState): Promise<void> {
  const tabs = state.tabs.filter((tab): tab is Tab & { session: string } => Boolean(tab.session));
  const active = state.pane.kind === 'tab' && tabs.some((tab) => tab.key === state.pane.key)
    ? state.pane.key
    : undefined;
  const saved: SavedTabs = { tabs, active };
  await SecureStore.setItemAsync(key, JSON.stringify(saved));
}

export function useTabs(cfg: HostConfig): [TabsState, Dispatch<TabAction>, boolean] {
  const key = storeKey(cfg);
  const [stored, setStored] = useState<StoredState>({ key, ready: false, state: INITIAL });

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
    void saveState(key, stored.state).catch(() => {});
  }, [key, stored]);

  const dispatch = useCallback<Dispatch<TabAction>>((action) => {
    setStored((current) => current.key === key && current.ready
      ? { ...current, state: tabsReducer(current.state, action) }
      : current);
  }, [key]);

  const current = stored.key === key ? stored : { key, ready: false, state: INITIAL };
  return [current.state, dispatch, current.ready];
}
