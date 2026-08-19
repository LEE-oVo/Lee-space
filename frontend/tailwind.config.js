/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: '#05060f',
          panel: '#0a0d1c',
          cyan: '#22d3ee',
          magenta: '#e879f9',
          green: '#4ade80',
          dim: '#64748b',
        },
      },
      fontFamily: {
        mono: ['Consolas', 'JetBrains Mono', 'Courier New', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 12px rgba(34,211,238,0.45), 0 0 40px rgba(34,211,238,0.15)',
        'neon-pink': '0 0 12px rgba(232,121,249,0.45), 0 0 40px rgba(232,121,249,0.15)',
      },
    },
  },
  plugins: [],
};
