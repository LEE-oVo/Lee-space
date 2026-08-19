import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: '首页' },
  { to: '/playground', label: '交互彩蛋' },
  { to: '/ai-lab', label: 'AI 实验室' },
  { to: '/stats', label: '数据看板' },
];

export default function Navbar() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-cyber-bg/70 border-b border-cyber-cyan/20">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <NavLink to="/" className="font-mono text-lg tracking-widest text-cyber-cyan">
          <span className="glitch" data-text="CYBERSHOW">CYBERSHOW</span>
        </NavLink>
        <div className="flex gap-6 font-mono text-sm">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `transition-colors hover:text-cyber-cyan ${
                  isActive ? 'text-cyber-cyan' : 'text-slate-400'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}
