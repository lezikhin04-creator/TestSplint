import type { CSSProperties, ReactNode } from 'react';

export type IconName = 'grid' | 'sparkles' | 'user' | 'arrow' | 'back' | 'close' | 'search' | 'check' | 'plus' | 'minus' | 'hand' | 'brush' | 'reset' | 'download' | 'share' | 'settings' | 'help' | 'chevron' | 'clock' | 'heart' | 'sun' | 'logout' | 'shield' | 'wifi' | 'save' | 'external';
const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  sparkles: <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /><path d="M20 2v4m-2-2h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  back: <path d="M20 12H5m6-6-6 6 6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  hand: <><path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v6c0 4-2 7-6 7h-1c-2 0-4-1-5-3l-4-6a1.5 1.5 0 0 1 2-2l2 1Z" /></>,
  brush: <><path d="m13 15 7-9a2 2 0 0 0-3-3l-8 9 4 3Z" /><path d="M9 12c-5-1-2 6-6 7 4 2 9 0 9-3" /></>,
  reset: <><path d="M4 9a8 8 0 1 1 0 7M4 3v6h6" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
  share: <><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7" /></>,
  settings: <><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3H9Z" /><circle cx="12" cy="12" r="3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 17h.01" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  heart: <path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 0 9 8 15 8-6 12-11 8-15Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" /></>,
  logout: <><path d="M10 4H4v16h6m4-12 4 4-4 4M9 12h11" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  wifi: <><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0" /><circle cx="12" cy="20" r=".5" /></>,
  save: <><path d="M4 3h13l3 3v15H4V3Z" /><path d="M8 3v6h8V3M8 21v-8h8v8" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" /></>,
};

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{paths[name]}</svg>;
}

export function PixelMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return <span className={`pixel-mark ${className}`} aria-hidden="true" style={{ '--mark-size': `${size}px` } as CSSProperties}>
    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => <i key={n} />)}
  </span>;
}
