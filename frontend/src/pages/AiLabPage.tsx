import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { chatWithAi, trackVisit } from '../api/client';

interface Msg {
  role: 'user' | 'ai';
  text: string;
}

const tools = [
  { title: 'AI 绘画', icon: '◐', desc: '文字生成图片 · AI 画廊', status: '即将接入' },
  { title: 'AI 语音', icon: '◑', desc: '文字转语音 · 多音色合成', status: '即将接入' },
  { title: 'AI 趣味屋', icon: '◒', desc: '占卜 / 解梦 / 起名', status: '即将接入' },
];

export default function AiLabPage() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'ai', text: '你好，我是 AI 实验室的占位机器人。当前为 mock 模式，接入真实大模型后我会正式上岗。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    trackVisit('/ai-lab');
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setLoading(true);
    try {
      const reply = await chatWithAi(text);
      setMsgs((m) => [...m, { role: 'ai', text: reply }]);
    } catch {
      setMsgs((m) => [...m, { role: 'ai', text: '[ERROR] 后端未连接，请确认 Spring Boot 已启动。' }]);
    } finally {
      setLoading(false);
    }
  };

  const showComingSoon = (title: string) => {
    setToast(`${title} 即将接入，敬请期待`);
    setTimeout(() => setToast(''), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="pt-16"
    >
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 neon-border rounded px-6 py-3 font-mono text-sm text-cyber-cyan">
          {toast}
        </div>
      )}

      <section className="max-w-6xl mx-auto px-6 py-16">
        <h1 className="font-mono text-3xl md:text-4xl text-center text-white glitch" data-text="AI LAB">
          AI LAB
        </h1>
        <p className="mt-4 text-center font-mono text-sm text-slate-400">
          AI 实验室 · 对话骨架已就绪（mock 模式）· 其余工具预留接入位
        </p>

        {/* 工具入口卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          {tools.map((t) => (
            <button
              key={t.title}
              onClick={() => showComingSoon(t.title)}
              className="neon-border rounded-xl p-6 text-left hover:shadow-neon-pink transition-shadow"
            >
              <div className="text-3xl text-cyber-magenta mb-3">{t.icon}</div>
              <h3 className="font-mono text-cyber-cyan mb-1">{t.title}</h3>
              <p className="text-sm text-slate-400">{t.desc}</p>
              <span className="inline-block mt-3 font-mono text-xs px-2 py-1 rounded border border-cyber-magenta/40 text-cyber-magenta">
                {t.status}
              </span>
            </button>
          ))}
        </div>

        {/* 对话骨架 */}
        <div className="neon-border rounded-xl mt-12 overflow-hidden">
          <div className="px-5 py-3 border-b border-cyber-cyan/15 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
            <span className="font-mono text-sm text-slate-300">AI 对话骨架 · MOCK MODE</span>
          </div>
          <div ref={listRef} className="h-72 overflow-y-auto p-5 space-y-3 bg-black/30">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2 font-mono text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30'
                      : 'bg-cyber-panel text-slate-300 border border-cyber-magenta/25'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="font-mono text-sm text-slate-500 animate-pulse">▍正在思考……</div>
            )}
          </div>
          <div className="flex border-t border-cyber-cyan/15">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="输入消息，回车发送……"
              className="flex-1 bg-transparent px-5 py-3 font-mono text-sm outline-none placeholder:text-slate-600"
            />
            <button
              onClick={send}
              className="px-6 font-mono text-sm text-cyber-bg bg-cyber-cyan hover:bg-cyber-magenta transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </section>
    </motion.div>
  );
}
