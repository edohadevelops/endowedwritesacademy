import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth } from '@/lib/data';
import type { AdminUser } from '@/lib/types';

interface AuthCtx {
  user: AdminUser | null;
  loading: boolean;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [u, setup] = await Promise.all([auth.getUser(), auth.needsSetup()]);
    setUser(u);
    setNeedsSetup(setup);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    // Sessions expire; re-check when the tab regains focus.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, needsSetup, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
