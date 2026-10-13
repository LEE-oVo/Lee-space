export function formatRelative(ts?: number | null): string {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

export function formatDateTime(ts?: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h} 小时 ${m} 分`;
}

export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function formatBps(bytesPerSecond: number): string {
  const bps = Math.max(0, bytesPerSecond || 0);
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(2)} GB/s`;
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(2)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export function formatClock(ts?: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
