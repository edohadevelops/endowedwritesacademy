import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; hidden?: boolean }

/** Small accessible action menu (button + list, arrow-key navigation). */
export function ActionMenu({ items, label, trigger, tip, tour }: { items: MenuItem[]; label: string; trigger?: ReactNode; tip?: string; tour?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const idx = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(idx + 1) % els.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(idx - 1 + els.length) % els.length]?.focus(); }
    if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus(); }
    if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={ref} className="relative" onKeyDown={onKey}>
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded text-stone hover:bg-ink/5 hover:text-ink"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-tip={tip ?? 'More actions'}
        data-tour={tour}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ?? <MoreHorizontal className="h-5 w-5" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-48 overflow-hidden rounded-md border border-line bg-paper py-1 shadow-lift">
          {visible.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              type="button"
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-ivory focus:bg-ivory focus:outline-none ${i.danger ? 'text-danger' : 'text-ink'}`}
              onClick={() => { setOpen(false); i.onSelect(); }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
