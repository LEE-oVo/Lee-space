import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { fetchStats, trackVisit, SiteStats } from '../api/client';

function StatNumber({ value, label }: { value: number; label: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const target = { v: 0 };
    const tween = gsap.to(target, {
      v: value,
      duration: 1.4,
      ease: 'power2.out',
      onUpdate: () => setDisplay(Math.round(target.v)),
    });
    return () => {
      tween.kill();
    };
  }, [value]);

  return (
    <div className="neon-border rounded-xl p-8 text-center">
      <div className="font-mono text-4xl md:text-5xl text-cyber-cyan">{display}</div>
      <div className="mt-3 font-mono text-xs text-slate-400 tracking-widest">{label}</div>
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    trackVisit('/stats');
    fetchStats()
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  const max = Math.max(1, ...(stats?.last7Days.map((d) => d.count) ?? [1]));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="pt-16"
    >
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h1 className="font-mono text-3xl md:text-4xl text-center text-white glitch" data-text="DATA BOARD">
          DATA BOARD
        </h1>
        <p className="mt-4 text-center font-mono text-sm text-slate-400">
          访客数据看板 · Spring Boot + MySQL 实时统计
        </p>

        {error && (
          <div className="mt-12 neon-border rounded-xl p-8 text-center font-mono text-sm text-cyber-magenta">
            [OFFLINE] 无法连接后端统计服务，请确认 Spring Boot 已启动
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
              <StatNumber value={stats.totalVisits} label="总访问量 PV" />
              <StatNumber value={stats.todayVisits} label="今日访问" />
              <StatNumber value={stats.totalVisitors} label="独立访客 UV" />
            </div>

            {/* 近 7 日柱状图 */}
            <div className="neon-border rounded-xl mt-8 p-8">
              <h2 className="font-mono text-sm text-slate-400 tracking-widest mb-6">
                近 7 日访问趋势
              </h2>
              <div className="flex items-end gap-3 h-40">
                {stats.last7Days.length === 0 && (
                  <p className="font-mono text-sm text-slate-500 self-center mx-auto">
                    暂无数据，多刷新几个页面试试
                  </p>
                )}
                {stats.last7Days.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                    <span className="font-mono text-xs text-cyber-cyan">{d.count}</span>
                    <div
                      className="w-full max-w-[42px] bar-glow rounded-t transition-all duration-700"
                      style={{ height: `${(d.count / max) * 100}%`, minHeight: 4 }}
                    />
                    <span className="font-mono text-[10px] text-slate-500">{d.day}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </motion.div>
  );
}
