import type {
  AuditLog, DshStatus, FileItem, FileQuota, FundAdvice, FundHolding, FundNavPoint,
  FundOverview, PermissionRecord, RoleRecord, SystemStats, User, WeatherData, WorkbenchUser,
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
  guestLogin: () => request<{ ok: boolean; ttl: number; user: User }>('/auth/guest', { method: 'POST' }),
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

  // q 为空时返回 .env 里配置的默认城市
  weather: (q?: string) =>
    request<WeatherData>(q ? `/weather?q=${encodeURIComponent(q)}` : '/weather'),

  // 基金行情：只做展示，判断由定时任务里的大模型产出后写入
  funds: () => request<FundOverview>('/funds'),
  fundHistory: (code: string, limit = 10, source?: string) =>
    request<{ history: FundAdvice[] }>(
      `/funds/history?code=${encodeURIComponent(code)}&limit=${limit}`
        + (source ? `&source=${encodeURIComponent(source)}` : '')
    ),
  fundSeries: (code: string, limit = 60) =>
    request<{ code: string; series: FundNavPoint[] }>(
      `/funds/series?code=${encodeURIComponent(code)}&limit=${limit}`
    ),
  createFundRecord: (payload: Record<string, unknown>) =>
    request<{ ok: boolean; id: number | null; allocation: { used: number; budget: number; remain: number } }>(
      '/funds/records',
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  setAdviceExecuted: (code: string, tradeDate: string, executed: boolean, source?: string) =>
    request<{ ok: boolean; summary: { added: number; reduced: number; count: number } }>('/funds/executed', {
      method: 'PATCH',
      body: JSON.stringify({ code, tradeDate, executed, source }),
    }),
  createFundHolding: (payload: Record<string, unknown>) =>
    request<{ ok: boolean; holding: FundHolding }>('/funds/holdings', { method: 'POST', body: JSON.stringify(payload) }),
  updateFundHolding: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean; holding: FundHolding }>(`/funds/holdings/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteFundHolding: (id: number) => request<{ ok: boolean }>(`/funds/holdings/${id}`, { method: 'DELETE' }),

  // 文件库
  files: () => request<{ files: FileItem[]; quota: FileQuota; categories: string[] }>('/files'),
  // 上传用 XHR 而不是 fetch：只有 XHR 能拿到上传进度
  uploadFile: (form: FormData, onProgress?: (percent: number) => void) =>
    new Promise<{ ok: boolean; id: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_PREFIX}/files`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data: { error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch { /* 非 JSON 响应 */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data as { ok: boolean; id: number });
        reject(new Error(data?.error || `上传失败 (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      xhr.send(form);
    }),
  updateFile: (id: number, patch: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/files/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteFile: (id: number) => request<{ ok: boolean }>(`/files/${id}`, { method: 'DELETE' }),

  listUsers: () => request<{ users: WorkbenchUser[] }>('/admin/users'),
  createUser: (payload: Record<string, unknown>) =>
    request<{ ok: boolean; id: number }>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE' }),
  roles: () => request<{ roles: RoleRecord[]; permissions: PermissionRecord[] }>('/admin/roles'),
  updateRolePermissions: (code: string, permissions: string[]) =>
    request<{ ok: boolean; roles: RoleRecord[] }>(`/admin/roles/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: JSON.stringify({ permissions }),
    }),
  audit: (limit = 100) => request<{ logs: AuditLog[] }>(`/admin/audit?limit=${limit}`),
};
