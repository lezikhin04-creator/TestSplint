import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon, PixelMark } from './Icon';
import type { IconName } from './Icon';

export function Button({ children, onClick, variant = 'primary', disabled, icon, type = 'button', className = '' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean; icon?: IconName; type?: 'button' | 'submit'; className?: string;
}) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={19} />}{children}</button>;
}

export function Loading({ label = 'Собираем пиксели…' }: { label?: string }) {
  return <div className="loading-state" role="status"><PixelMark size={38} className="breathing" /><span>{label}</span></div>;
}

export function ErrorPanel({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-panel" role="alert"><Icon name="wifi" size={24} /><div><strong>Небольшая пауза</strong><p>{message}</p></div>{retry && <Button variant="secondary" onClick={retry}>Попробовать снова</Button>}</div>;
}

export function EmptyState({ title, children, action, icon = 'sparkles' }: { title: string; children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={32} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialog) {
        const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],select,textarea,[tabindex="0"]')];
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <button className="icon-button modal-close" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button>
      <h2>{title}</h2>{children}
    </div>
  </div>;
}

export function BrandFlower({ className = '' }: { className?: string }) {
  const pixels = [
    '....PP.PP....',
    '...PPPPPPP...',
    '...PPPPPPP...',
    '....PPPPP....',
    '.....PPP.....',
    '......G......',
    '..GG..G......',
    '...GG.G..GG..',
    '....GGG.GG...',
    '......GGG....',
    '......G......',
    '......G......',
  ];
  return <svg viewBox="0 0 130 120" className={`brand-flower ${className}`} role="img" aria-label="Пиксельный цветок Splint">
    {pixels.flatMap((row, y) => [...row].map((cell, x) => cell !== '.' ? <rect key={`${x}-${y}`} x={x * 10} y={y * 10} width={10} height={10} fill={cell === 'P' ? '#9571ef' : '#537c58'} /> : null))}
  </svg>;
}
