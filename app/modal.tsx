'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { X } from 'lucide-react';

gsap.registerPlugin(useGSAP);

export default function Modal({ children, title, onClose, wide = false, dismissible = true }: { children: ReactNode; title: string; onClose: () => void; wide?: boolean; dismissible?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; };
  }, []);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => { gsap.from('.modal-panel', { y: 14, autoAlpha: 0, duration: .35, ease: 'power3.out' }); });
    return () => mm.revert();
  }, { scope: ref });
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={e => { if (!dismissible) e.preventDefault(); }} onClose={onClose} onClick={e => { if (dismissible && e.target === e.currentTarget) onClose(); }}>
    <div className="modal-panel"><div className="modal-header"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="关闭" disabled={!dismissible}><X size={20} /></button></div>{children}</div>
  </dialog>;
}
