import type { PermissionRecord } from '../types';

/** 权限模块的中文名（与后端 permissions.module 对应） */
export const MODULE_LABEL: Record<string, string> = {
  overview: '概览 / 首页',
  dsh: 'DeepSeek Harness',
  system: '系统状态',
  user: '用户管理',
  role: '角色与权限',
  audit: '审计日志',
  fund: '基金行情',
  file: '文件库',
};

/** 权限展示用中文描述，找不到时退回权限码 */
export function permissionLabel(p: PermissionRecord | undefined): string {
  if (!p) return '未知权限';
  return p.description || p.code;
}
