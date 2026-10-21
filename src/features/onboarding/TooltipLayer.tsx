import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onboarding } from './store';

/**
 * One floating tooltip for the whole admin. Any element with data-tip="…"
 * shows it on mouse hover or keyboard focus. Touch screens don't get hover
 * tips; the page tours cover them. Can be switched off in Settings → Account.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [on, setOn] = useState(onboarding.tipsOn());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => onboarding.subscribe(() => setOn(onboarding.tipsOn())), []);

  useEffect(() => {
    if (!on) { setTip(null); return; }
    const hide = () => {
      clearTimeout(timer.current);
      if (current.current) current.current.removeAttribute('aria-describedby');
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      const text = el.dataset.tip;
      if (!text || current.current === el) return;
      hide();
      current.current = el;
      timer.current = setTimeout(() => {
        if (!el.isConnected) return;
        el.setAttribute('aria-describedby', 'admin-tooltip');
        setTip({ text, rect: el.getBoundingClientRect() });
      }, delay);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
      if (el) show(el, 450);
      else if (current.current) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
      if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el, 150);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [on]);

  if (!tip) return null;
  const width = Math.min(260, window.innerWidth - 16);
  const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const placeAbove = tip.rect.top > 70;
  const style: React.CSSProperties = placeAbove
    ? { left, bottom: window.innerHeight - tip.rect.top + 8, width }
    : { left, top: tip.rect.bottom + 8, width };

  return createPortal(
    <div className="pointer-events-none fixed z-[95] flex justify-center" style={style}>
      <div id="admin-tooltip" role="tooltip" className="rounded bg-obsidian px-2.5 py-1.5 text-center text-xs leading-snug text-ivory shadow-lift">
        {tip.text}
      </div>
    </div>,
    document.body,
  );
}
