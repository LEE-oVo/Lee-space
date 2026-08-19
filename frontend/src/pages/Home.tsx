import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Hero3D from '../components/Hero3D';
import Typewriter from '../components/Typewriter';
import SkillCards from '../components/SkillCards';
import TerminalSim from '../components/TerminalSim';
import { isLowPowerDevice, webglSupported } from '../utils/device';
import { trackVisit } from '../api/client';

export default function Home() {
  const [use3D, setUse3D] = useState(true);

  useEffect(() => {
    trackVisit('/');
    setUse3D(!isLowPowerDevice() && webglSupported());
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* 首屏 */}
      <section className="relative h-screen overflow-hidden">
        {use3D ? <Hero3D /> : <div className="absolute inset-0 cyber-grid" />}

        <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
          <p className="font-mono text-cyber-magenta text-sm tracking-[0.5em] mb-6">
            // SYSTEM ONLINE
          </p>
          <h1
            className="glitch font-mono text-5xl md:text-7xl font-bold tracking-widest text-white"
            data-text="CYBERSHOW"
          >
            CYBERSHOW
          </h1>
          <p className="mt-6 font-mono text-lg md:text-xl text-cyber-cyan min-h-[2em]">
            <Typewriter
              phrases={[
                '赛博技术秀场 · 由 AI 从 0 构建',
                '3D VISUAL / NEON UI / AI LAB',
                'REACT + SPRING BOOT + MYSQL',
                '每一行代码都来自 AI 之手',
              ]}
            />
          </p>
          <div className="mt-16 animate-bounce text-cyber-cyan font-mono text-sm opacity-70">
            ▼ SCROLL ▼
          </div>
        </div>

        {/* 底部渐隐过渡 */}
        <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-cyber-bg to-transparent z-[5]" />
      </section>

      {/* 能力卡片 + 终端 */}
      <SkillCards />
      <TerminalSim />
    </motion.div>
  );
}
