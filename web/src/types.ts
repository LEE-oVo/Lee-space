export interface User {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  avatarColor: string;
  roles: string[];
  permissions: string[];
  lastLoginAt?: number | null;
  lastLoginIp?: string | null;
}

export interface DshStatus {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  uptime: number | null;
  port: number;
  path: string;
  token: string | null;
  canStart: boolean;
  canStop: boolean;
  canAccess: boolean;
}

export interface SystemStats {
  host: string;
  platform: string;
  cpuCount: number;
  loadAvg: number[];
  mem: { totalMb: number; freeMb: number };
  swap: { totalMb: number; freeMb: number };
  disk: { totalGb: number; freeGb: number };
  uptimeSeconds: number;
  dsh: { running: boolean; pid: number | null; uptime: number | null };
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  result: string;
  created_at: number;
}

export interface WorkbenchUser {
  id: number;
  username: string;
  email: string | null;
  displayName: string;
  avatarColor: string;
  status: string;
  roles: string[];
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  createdAt: number;
}

export interface RoleRecord {
  id: number;
  code: string;
  name: string;
  description: string;
  is_system: number;
  permissions: string[];
}

export interface PermissionRecord {
  code: string;
  module: string;
  description: string;
}
