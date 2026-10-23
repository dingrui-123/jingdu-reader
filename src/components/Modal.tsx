import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
export function Modal({ title, onClose, children, wide = false, busy = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return <dialog className={`modal ${wide ? 'wide' : ''}`} ref={ref} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (e.target === ref.current && !busy) onClose(); }} aria-label={title} aria-busy={busy}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close"/></button></div>
    {children}
  </dialog>;
}
