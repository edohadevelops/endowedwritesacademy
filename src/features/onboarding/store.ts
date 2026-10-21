// Remembers which page tours the admin has finished or dismissed, and whether
// hover tips are on. Stored per browser for now; with Supabase this can move
// to the admin's profile so it follows them across devices.

const KEY = 'endowed.onboarding.v1';

interface State {
  dismissed: Record<string, string>; // tourId -> ISO date
  tipsOn: boolean;
}

const read = (): State => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<State>;
    return { dismissed: raw.dismissed ?? {}, tipsOn: raw.tipsOn ?? true };
  } catch {
    return { dismissed: {}, tipsOn: true };
  }
};
const write = (s: State) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
};

const listeners = new Set<() => void>();
export const onboarding = {
  isDismissed: (id: string) => Boolean(read().dismissed[id]),
  dismiss: (id: string) => { const s = read(); s.dismissed[id] = new Date().toISOString(); write(s); },
  resetTours: () => { const s = read(); s.dismissed = {}; write(s); },
  tipsOn: () => read().tipsOn,
  setTipsOn: (on: boolean) => { const s = read(); s.tipsOn = on; write(s); },
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
