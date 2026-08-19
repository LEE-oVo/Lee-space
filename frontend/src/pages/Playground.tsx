import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import MatrixRain from '../components/MatrixRain';
import ParticleTrail from '../components/ParticleTrail';
import { trackVisit } from '../api/client';

const SECRET = 'cyber';

export default function Playground() {
  const [glitching, setGlitching] = useState(false);
  const buffer = useRef('');

  useEffect(() => {
    trackVisit('/playground');

    // 隐藏指令：连续键入 cyber 触发全屏故障特效
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(-SECRET.length);
      if (buffer.current === SECRET) {
        buffer.current = '';
        setGlitching(true);
        setTimeout(() => setGlitching(false), 2000);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="pt-16"
    >
      {glitching && <div className="fullscreen-glitch" />}

      {/* 矩阵雨标题区 */}
      <section className="relative h-[45vh] overflow-hidden flex items-center justify-center">
        <MatrixRain />
        <div className="relative z-10 text-center px-6">
          <h1 className="font-mono text-3xl md:text-5xl text-white glitch" data-text="PLAYGROUND">
            PLAYGROUND
          </h1>
          <p className="mt-4 font-mono text-cyber-cyan text-sm md:text-base">
            交互彩蛋区 · 试着在页面上连续键入「
            <span className="text-cyber-magenta">cyber</span>
            」……
          </p>
        </div>
      </section>

      {/* 粒子拖尾区 */}
      <section className="relative h-[50vh] border-t border-cyber-cyan/15 overflow-hidden">
        <ParticleTrail />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="font-mono text-slate-500 text-sm tracking-widest">
            [ 移动鼠标 · 唤醒粒子 ]
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="font-mono text-sm text-slate-400 leading-8">
          这里埋藏着更多待发现的彩蛋。
          <br />
          AI 对话机器人正在 <span className="text-cyber-cyan">AI 实验室</span> 待机。
        </p>
      </section>
    </motion.div>
  );
}
