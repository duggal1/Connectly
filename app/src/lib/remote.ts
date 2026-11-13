import { api, json } from './api';
import type { HostConfig } from './storage';

export type AgentKind = 'claude' | 'codex' | 'opencode' | 'gemini' | 'aider' | '';
export type RemoteState = 'running' | 'idle' | 'shell';

export interface RemoteSession {
  id: string;
  name: string;
  createdAt: number;
  lastActive: number;
  windows: number;
  panes: number;
  macClients: number;
  phones: number;
  cols: number;
  rows: number;
  command: string;
  agent: AgentKind;
  state: RemoteState;
  title: string;
  cwd: string;
  preview: string;
}

export interface LooseAgent {
  pid: number;
  agent: AgentKind;
  tty: string;
  cwd: string;
  startedAt: number;
  state: 'running' | 'idle';
}

export interface RemoteSnapshot {
  type: 'sessions';
  at: number;
  host: string;
  sessions: RemoteSession[];
  loose: LooseAgent[];
}

export interface RemoteInfo {
  available: boolean;
  socket: string;
  tmux: string;
  hook: string;
}

export interface RemoteSessionGrant {
  id: string;
  name: string;
}

export const remoteApi = {
  list: (cfg: HostConfig) => api<RemoteSnapshot>(cfg, '/api/remote/sessions'),
  info: (cfg: HostConfig) => api<RemoteInfo>(cfg, '/api/remote/info'),
  create: (cfg: HostConfig, body: { name: string; command: string }) =>
    api<RemoteSessionGrant>(cfg, '/api/remote/sessions', json('POST', body)),
  interrupt: (cfg: HostConfig, id: string) =>
    api<void>(cfg, `/api/remote/sessions/${encodeURIComponent(id)}/interrupt`, { method: 'POST' }),
  end: (cfg: HostConfig, id: string) =>
    api<void>(cfg, `/api/remote/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  rename: (cfg: HostConfig, id: string, name: string) =>
    api<{ id: string; name: string }>(cfg, `/api/remote/sessions/${encodeURIComponent(id)}/rename`, json('POST', { name })),
  detachOthers: (cfg: HostConfig, id: string) =>
    api<void>(cfg, `/api/remote/sessions/${encodeURIComponent(id)}/detach-others`, { method: 'POST' }),
  sendKeys: (cfg: HostConfig, id: string, keys: string[]) =>
    api<void>(cfg, `/api/remote/sessions/${encodeURIComponent(id)}/keys`, json('POST', { keys })),
  stopLoose: (cfg: HostConfig, agent: LooseAgent, how: 'int' | 'term' | 'kill') =>
    api<void>(cfg, `/api/remote/loose/${agent.pid}/stop`, json('POST', { startedAt: agent.startedAt, how })),
};
