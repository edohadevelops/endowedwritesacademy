import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X } from 'lucide-react';
import { TOURS, type TourId } from './tours';
import { onboarding } from './store';

const START_EVENT = 'endowed:start-tour';

function findTarget(name: string): HTMLElement | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width > 0 && r.height > 0 && style.visibility !== 'hidden') return el;
  }
  return null;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Shows a page's tour the first time the page is opened, until the admin
 * finishes or skips it. The "?" button (TourButton) replays it any time.
 */
export function PageTour({ id }: { id: TourId }) {
  const tour = TOURS[id];
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const available = useCallback(() => tour.steps.map((s, i) => (findTarget(s.target) ? i : -1)).filter((i) => i >= 0), [tour]);

  const start = useCallback(() => {
    const steps = available();
    if (!steps.length) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setIndex(steps[0]);
  }, [available]);

  // Auto-start once the page's elements have rendered.
  useEffect(() => {
    if (onboarding.isDismissed(id)) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (document.querySelector('dialog[open]')) return; // wait for any open dialog
      if (available().length >= Math.min(2, tour.steps.length) || tries > 20) {
        clearInterval(t);
        if (available().length) start();
      }
    }, 200);
    return () => clearInterval(t);
  }, [id, available, start, tour.steps.length]);

  // Replay on request.
  useEffect(() => {
    const onStart = (e: Event) => { if ((e as CustomEvent).detail === id) start(); };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, [id, start]);

  const step = index === null ? null : tour.steps[index];

  // Track the target's position.
  useLayoutEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (!el) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    let raf = 0;
    const update = () => { raf = 0; setRect(el.getBoundingClientRect()); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    const settle = setTimeout(update, 400);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => { clearTimeout(settle); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); cancelAnimationFrame(raf); };
  }, [step]);

  useEffect(() => { if (step) cardRef.current?.focus(); }, [step]);

  const close = (dismiss: boolean) => {
    if (dismiss) onboarding.dismiss(id);
    setIndex(null);
    setRect(null);
    returnFocus.current?.focus?.();
  };
  const order = index === null ? [] : available();
  const pos = index === null ? -1 : order.indexOf(index);
  const go = (dir: 1 | -1) => {
    const next = order[pos + dir];
    if (next === undefined) close(true);
    else setIndex(next);
  };

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft' && pos > 0) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!step || !rect) return null;

  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile = vw < 640;
  const cardW = Math.min(340, vw - 32);
  const below = rect.bottom + pad + 12;
  const above = rect.top - pad - 12;
  let style: React.CSSProperties;
  if (mobile) {
    style = { left: 16, right: 16, bottom: 16 };
  } else if (vh - below > 220) {
    style = { top: below, left: Math.min(Math.max(16, rect.left), vw - cardW - 16), width: cardW };
  } else if (above > 220) {
    style = { bottom: vh - above, left: Math.min(Math.max(16, rect.left), vw - cardW - 16), width: cardW };
  } else {
    style = { top: Math.max(16, Math.min(rect.top, vh - 260)), left: rect.right + 16 + cardW < vw ? rect.right + 16 : Math.max(16, rect.left - cardW - 16), width: cardW };
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      {/* Dimmed page with a cut-out around the highlighted element. */}
      <div
        className="pointer-events-none fixed rounded-md ring-2 ring-copper transition-all duration-200"
        style={{
          top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          boxShadow: '0 0 0 9999px rgb(20 17 19 / 0.55)',
        }}
        aria-hidden
      />
      {/* Blocks clicks on the page while a tip is open; use Skip or Esc to leave. */}
      <div className="fixed inset-0" aria-hidden />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="animate-rise fixed rounded-lg bg-paper p-5 text-ink shadow-cover outline-none"
        style={style}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-accent-strong">{tour.title}</p>
            <h2 id="tour-title" className="mt-1 font-serif text-xl font-medium leading-snug">{step.title}</h2>
          </div>
          <button className="-m-1.5 rounded p-1.5 text-stone hover:bg-ink/5 hover:text-ink" onClick={() => close(true)} aria-label="Close tips for this page">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p id="tour-body" className="mt-2 text-sm leading-relaxed text-stone">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-stone" aria-label={`Tip ${pos + 1} of ${order.length}`}>{pos + 1} of {order.length}</span>
          <div className="flex gap-2">
            {pos === 0 ? (
              <button className="btn btn-ghost btn-sm" onClick={() => close(true)}>Skip tips</button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => go(-1)}>Back</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => go(1)} autoFocus>
              {pos === order.length - 1 ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "?" button that replays the current page's tour. */
export function TourButton({ id, compact = false }: { id: TourId; compact?: boolean }) {
  return (
    <button
      type="button"
      className={`btn btn-outline px-0 ${compact ? 'h-8 min-h-8 w-8' : 'h-10 w-10'}`}
      onClick={() => window.dispatchEvent(new CustomEvent(START_EVENT, { detail: id }))}
      aria-label="Show tips for this page"
      data-tip="Show the tips for this page again"
      data-tour="page-help"
    >
      <HelpCircle className="h-4 w-4" aria-hidden />
    </button>
  );
}
