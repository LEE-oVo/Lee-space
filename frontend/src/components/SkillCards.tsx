import { useEffect, useRef, MouseEvent } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface Skill {
  title: string;
  desc: string;
  icon: string;
  metric: number;
  metricLabel: string;
}

const skills: Skill[] = [
  { title: 'THREE.JS / WEBGL', desc: '实时 3D 渲染、粒子系统与着色器特效', icon: '◈', metric: 60, metricLabel: 'FPS 目标' },
  { title: 'REACT 18', desc: '组件化架构、并发渲染与状态管理', icon: '⚛', metric: 42, metricLabel: '组件数' },
  { title: 'SPRING BOOT', desc: 'RESTful API、事务与高可用后端服务', icon: '❐', metric: 99, metricLabel: 'SLA %' },
  { title: 'MYSQL / DOCKER', desc: '数据持久化与容器化一键部署', icon: '◫', metric: 100, metricLabel: '% 容器化' },
];

/** 单张 3D 倾斜卡片 */
function TiltCard({ skill, index }: { skill: Skill; index: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(800px) rotateY(${px * 14}deg) rotateX(${-py * 14}deg) translateZ(8px)`;
  };

  const onLeave = () => {
    const el = cardRef.current;
    if (el) el.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg)';
  };

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    // 滚动进入视口时上浮显现
    gsap.fromTo(
      el,
      { opacity: 0, y: 60 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        delay: index * 0.12,
        scrollTrigger: { trigger: el, start: 'top 85%' },
      },
    );
    // 数字滚动
    if (numRef.current) {
      const target = { v: 0 };
      gsap.to(target, {
        v: skill.metric,
        duration: 1.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 85%' },
        onUpdate: () => {
          if (numRef.current) numRef.current.textContent = String(Math.round(target.v));
        },
      });
    }
    return () => {
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, [index, skill.metric]);

  return (
    <div
      ref={cardRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="neon-border rounded-xl p-6 transition-transform duration-150 will-change-transform hover:shadow-neon"
    >
      <div className="text-3xl text-cyber-cyan mb-3">{skill.icon}</div>
      <h3 className="font-mono text-cyber-cyan tracking-wider mb-2">{skill.title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed mb-4">{skill.desc}</p>
      <div className="flex items-baseline gap-2">
        <span ref={numRef} className="font-mono text-3xl text-cyber-magenta">0</span>
        <span className="font-mono text-xs text-slate-500">{skill.metricLabel}</span>
      </div>
    </div>
  );
}

export default function SkillCards() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <h2 className="font-mono text-2xl text-center mb-12 tracking-widest">
        <span className="text-cyber-cyan">&gt;&gt;</span> 技术能力矩阵{' '}
        <span className="text-cyber-cyan">&lt;&lt;</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {skills.map((s, i) => (
          <TiltCard key={s.title} skill={s} index={i} />
        ))}
      </div>
    </section>
  );
}
