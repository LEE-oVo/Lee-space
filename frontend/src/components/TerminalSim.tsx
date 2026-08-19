import { useEffect, useRef, useState } from 'react';

const lines = [
  { text: '$ whoami', type: 'cmd' },
  { text: 'cybershow // 赛博秀场 · 由 AI 全栈构建', type: 'out' },
  { text: '$ uname -a', type: 'cmd' },
  { text: 'React 18 + Spring Boot + MySQL 8.0 · Docker Compose 部署', type: 'out' },
  { text: '$ ./deploy --target=cloud', type: 'cmd' },
  { text: '[OK] mysql        up', type: 'ok' },
  { text: '[OK] backend      up', type: 'ok' },
  { text: '[OK] nginx        up · listening :80', type: 'ok' },
  { text: '$ echo "READY FOR ACCEPTANCE"', type: 'cmd' },
  { text: 'READY FOR ACCEPTANCE', type: 'out' },
] as const;

/** 终端模拟器：逐行打字输出，点击可重播 */
export default function TerminalSim() {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [charProgress, setCharProgress] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (visibleLines >= lines.length) return;
    const current = lines[visibleLines];
    if (charProgress < current.text.length) {
      const step = current.type === 'cmd' ? 2 : 4;
      timer.current = window.setTimeout(
        () => setCharProgress((c) => Math.min(c + step, current.text.length)),
        current.type === 'cmd' ? 45 : 12,
      );
    } else {
      timer.current = window.setTimeout(() => {
        setVisibleLines((n) => n + 1);
        setCharProgress(0);
      }, current.type === 'cmd' ? 300 : 120);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visibleLines, charProgress]);

  const colorOf = (type: string) =>
    type === 'cmd' ? 'text-cyber-green' : type === 'ok' ? 'text-cyber-cyan' : 'text-slate-300';

  return (
    <section className="max-w-3xl mx-auto px-6 pb-24">
      <div
        className="neon-border rounded-lg overflow-hidden cursor-pointer"
        onClick={() => {
          setVisibleLines(0);
          setCharProgress(0);
        }}
        title="点击重播"
      >
        <div className="flex items-center gap-2 px-4 py-2 bg-cyber-panel border-b border-cyber-cyan/15">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <span className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="ml-3 font-mono text-xs text-slate-500">cybershow@cloud: ~</span>
        </div>
        <div className="p-5 font-mono text-sm min-h-[280px] bg-black/40 leading-7">
          {lines.slice(0, visibleLines).map((l, i) => (
            <div key={i} className={colorOf(l.type)}>{l.text}</div>
          ))}
          {visibleLines < lines.length && (
            <div className={colorOf(lines[visibleLines].type)}>
              {lines[visibleLines].text.slice(0, charProgress)}
              <span className="type-cursor" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
