import { useEffect, useRef } from 'react';

const CHARS = 'アイウエオカキクケコサシスセソ01<>/\\|=+*';

/** 矩阵代码雨背景（Canvas） */
export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const fontSize = 16;
    let columns = 0;
    let drops: number[] = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      columns = Math.floor(canvas.width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -50);
    };
    resize();
    window.addEventListener('resize', resize);

    let last = 0;
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - last < 50) return; // 约 20fps，足够流畅且省电
      last = time;

      ctx.fillStyle = 'rgba(5, 6, 15, 0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < columns; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        // 头部字符更亮
        ctx.fillStyle = Math.random() > 0.97 ? '#e879f9' : 'rgba(34, 211, 238, 0.75)';
        ctx.fillText(char, x, y);
        drops[i] = y > canvas.height && Math.random() > 0.975 ? 0 : drops[i] + 1;
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-40" />;
}
