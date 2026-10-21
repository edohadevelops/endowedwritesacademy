import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { settings as settingsApi, subscribe } from '@/lib/data';
import type { SiteSettings } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { darken, hexToRgb } from '@/lib/utils/format';

interface SiteCtx {
  settings: SiteSettings;
  logoUrl: string | null;
  ready: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SiteCtx | null>(null);

/** Applies brand settings to the design tokens. */
export function applyBrand(s: Pick<SiteSettings, 'accentColor' | 'typePreset'>) {
  const root = document.documentElement;
  const rgb = hexToRgb(s.accentColor);
  const strong = hexToRgb(darken(s.accentColor, 0.18));
  if (rgb && strong) {
    root.style.setProperty('--accent', rgb.join(' '));
    root.style.setProperty('--accent-strong', strong.join(' '));
  }
  root.dataset.type = s.typePreset;
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<SiteCtx, 'refresh'>>({ settings: DEFAULT_SETTINGS, logoUrl: null, ready: false });

  const refresh = useCallback(async () => {
    const s = await settingsApi.get();
    const logoUrl = await settingsApi.logoUrl(s);
    applyBrand(s);
    setState({ settings: s, logoUrl, ready: true });
  }, []);

  useEffect(() => {
    refresh().catch(() => setState((x) => ({ ...x, ready: true })));
    return subscribe((key) => {
      if (key === 'settings' || key === 'media') void refresh();
    });
  }, [refresh]);

  return <Ctx.Provider value={{ ...state, refresh }}>{children}</Ctx.Provider>;
}

export function useSite(): SiteCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSite must be used inside SiteProvider');
  return c;
}
