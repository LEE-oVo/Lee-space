/**
 * 低端设备检测：CPU 核心数或内存不足时，3D 场景降级为 CSS 背景。
 */
export function isLowPowerDevice(): boolean {
  const cores = navigator.hardwareConcurrency ?? 4;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = nav.deviceMemory ?? 4;
  return cores < 4 || memory < 4;
}

export function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
