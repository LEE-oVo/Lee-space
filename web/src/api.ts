import type {
  AuditLog, DshStatus, PermissionRecord, RoleRecord, SystemStats, User, WorkbenchUser,
} from './types';

// 注意：/api 前缀已整段让给 DeepSeek Harness，工作台自身接口统一走 /wb-api
const API_PREFIX = '/wb-api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error || `请求失败 (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  dshStatus: () => request<DshStatus>('/dsh/status'),
  dshStart: () => request<{ ok: boolean } & DshStatus>('/dsh/start', { method: 'POST' }),
  dshStop: () => request<{ ok: boolean } & DshStatus>('/dsh/stop', { method: 'POST' }),
  dshLog: (lines = 120) => request<{ log: string }>(`/dsh/log?lines=${lines}`),

  systemStats: () => request<SystemStats>('/system/stats'),

  listUsers: () => request<{ users: WorkbenchUser[] }>('/admin/users'),
  createUser: (payload: Record<string, unknown>) =>
    request<{ ok: boolean; id: number }>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE' }),
  roles: () => request<{ roles: RoleRecord[]; permissions: PermissionRecord[] }>('/admin/roles'),
  audit: (limit = 100) => request<{ logs: AuditLog[] }>(`/admin/audit?limit=${limit}`),
};
