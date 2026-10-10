import fs from 'node:fs/promises';
import os from 'node:os';

// 系统指标采样器
//
// CPU 使用率与网络速率都需要「两个时间点之差」才能算出来，
// 如果等请求来了再现场采样，每次请求都要多等几百毫秒。
// 这里改为后台每 2 秒采一次，接口直接返回最近一次结果，
// 这样前端 1~3 秒轮询时也几乎没有额外开销。

const INTERVAL_MS = 2000;

const state = {
  cpuUsagePct: 0,
  netRxBps: 0,
  netTxBps: 0,
  procs: 0,
  sampledAt: 0,
};

let prevCpu = null;
let prevNet = null;

async function readCpu() {
  const text = await fs.readFile('/proc/stat', 'utf8');
  const parts = text.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;
  const idleAll = idle + iowait;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { total, idle: idleAll };
}

async function readNet() {
  const text = await fs.readFile('/proc/net/dev', 'utf8');
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n').slice(2)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    if (!name || name === 'lo') continue;
    const fields = line.slice(idx + 1).trim().split(/\s+/).map(Number);
    if (Number.isNaN(fields[0]) || Number.isNaN(fields[8])) continue;
    rx += fields[0];
    tx += fields[8];
  }
  return { rx, tx };
}

async function countProcs() {
  const entries = await fs.readdir('/proc');
  let n = 0;
  for (const e of entries) if (/^\d+$/.test(e)) n += 1;
  return n;
}

async function sample() {
  try {
    const cpu = await readCpu();
    if (prevCpu) {
      const dTotal = cpu.total - prevCpu.total;
      const dIdle = cpu.idle - prevCpu.idle;
      if (dTotal > 0) {
        state.cpuUsagePct = +((((dTotal - dIdle) / dTotal) * 100)).toFixed(1);
      }
    }
    prevCpu = cpu;
  } catch {
    prevCpu = null;
  }

  try {
    const net = await readNet();
    const now = Date.now();
    if (prevNet) {
      const seconds = (now - prevNet.at) / 1000;
      if (seconds > 0) {
        state.netRxBps = Math.max(0, Math.round((net.rx - prevNet.rx) / seconds));
        state.netTxBps = Math.max(0, Math.round((net.tx - prevNet.tx) / seconds));
      }
    }
    prevNet = { rx: net.rx, tx: net.tx, at: now };
  } catch {
    prevNet = null;
  }

  try {
    state.procs = await countProcs();
  } catch {
    // /proc 不可读时保持上一次结果
  }

  state.sampledAt = Date.now();
}

// 容器或精简环境里可能没有 /proc，这时退化为 0，接口仍可用
if (os.platform() === 'linux') {
  void sample();
  const timer = setInterval(() => { void sample(); }, INTERVAL_MS);
  timer.unref();
}

export function metrics() {
  return {
    cpu: { usagePct: state.cpuUsagePct, cores: os.cpus().length },
    net: { rxBps: state.netRxBps, txBps: state.netTxBps },
    procs: state.procs,
    sampledAt: state.sampledAt,
  };
}
