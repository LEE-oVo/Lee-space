import type { CSSProperties } from 'react';

const paths: Record<string, string> = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  spark: 'M12 3l2.1 5.6L20 11l-5.9 2.4L12 19l-2.1-5.6L4 11l5.9-2.4z',
  terminal: 'M4 5h16v14H4zM8 10l2.5 2L8 14M12.5 14H16',
  users: 'M16 19v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V19M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a4 4 0 0 0-3-3.87M16 4.63a4 4 0 0 1 0 7.75',
  audit: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h7M9 17h5',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.67 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.56 1z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  login: 'M15 21h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4M10 17l-5-5 5-5M3 12h12',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  collapse: 'M15 18l-6-6 6-6',
  expand: 'M9 18l6-6-6-6',
  check: 'M20 6L9 17l-5-5',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.6 3-3.2 3H16a2 2 0 0 0-1.4 3.4A1.9 1.9 0 0 1 12 21M7.5 11.5h.01M12 7.5h.01M16.5 11.5h.01',
  cpu: 'M6 6h12v12H6zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3.5 2',
};

interface IconProps {
  name: keyof typeof paths | string;
  size?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, style }: IconProps) {
  const d = paths[name] || paths.overview;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
