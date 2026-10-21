import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { auth, backend, AppError, userMessage } from '@/lib/data';
import { useAuth } from '@/context/AuthContext';
import { useSite } from '@/context/SiteContext';
import { useHead } from '@/features/seo/useHead';
import { Logo } from '@/components/ui/Logo';

function AuthShell({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const { settings } = useSite();
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[0.9fr_1.1fr]">
      <div className="on-dark relative hidden overflow-hidden bg-obsidian p-12 text-ivory lg:flex lg:flex-col lg:justify-between">
        <Logo />
        <div>
          <p className="max-w-md font-serif text-[2.6rem] leading-[1.1]">{settings.heroTitle}</p>
          <p className="mt-5 max-w-sm text-mist">The writing desk for {settings.siteName}. Draft, publish and look after the blog from here.</p>
        </div>
        <span className="pointer-events-none absolute -bottom-24 -right-10 select-none font-serif text-[26rem] leading-none text-copper/10" aria-hidden>E</span>
      </div>
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden"><Logo tone="light" /></div>
          <h1 className="font-serif text-3xl font-medium">{title}</h1>
          <p className="mt-2 text-stone">{intro}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} className="input pr-11" value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} aria-invalid={invalid} aria-describedby={describedBy} required />
      <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-stone hover:text-ink" onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function AdminLogin() {
  useHead({ title: 'Sign in', noindex: true });
  const { user, needsSetup, loading, refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const next = params.get('next')?.startsWith('/admin') ? params.get('next')! : '/admin';

  if (!loading && needsSetup) return <Navigate to="/admin/setup" replace />;
  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth.signIn(email, password);
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(userMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" intro="Use the administrator account for this site.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div>
          <label htmlFor="password" className="field-label">Password</label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" invalid={Boolean(error)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button className="mt-6 text-sm text-stone underline-offset-4 hover:text-ink hover:underline" onClick={() => setShowHelp((s) => !s)} aria-expanded={showHelp}>
        Forgot your password?
      </button>
      {showHelp && (backend.passwordReset ? <ResetRequest initialEmail={email} /> : (
        <p className="mt-3 rounded-md border border-line bg-ivory p-4 text-sm leading-relaxed text-stone">
          Email password resets arrive with the Supabase connection. Until then, this preview stores the account in this browser only, and the site developer can reset it for you.
        </p>
      ))}
    </AuthShell>
  );
}

export function AdminSetup() {
  useHead({ title: 'Set up', noindex: true });
  const { needsSetup, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!loading && !needsSetup) return <Navigate to="/admin/login" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setErrors({ confirm: 'The passwords don’t match.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      await auth.createFirstAdmin(form);
      await refresh();
      navigate('/admin', { replace: true });
    } catch (err) {
      setErrors(err instanceof AppError && err.fields ? err.fields : { form: userMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AuthShell title="Create the administrator" intro="This one-time step creates the owner account. Once it exists, this page closes and no one else can sign up.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="name" className="field-label">Your name</label>
          <input id="name" className="input" value={form.displayName} onChange={(e) => set('displayName')(e.target.value)} autoComplete="name" />
          <p className="field-hint">Shown as the author on new articles.</p>
        </div>
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" type="email" className="input" value={form.email} onChange={(e) => set('email')(e.target.value)} autoComplete="username" aria-invalid={Boolean(errors.email)} />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="password" className="field-label">Password</label>
          <PasswordInput id="password" value={form.password} onChange={set('password')} autoComplete="new-password" invalid={Boolean(errors.password)} describedBy="pw-hint" />
          <p id="pw-hint" className={errors.password ? 'field-error' : 'field-hint'}>{errors.password ?? 'At least 12 characters, with letters and numbers.'}</p>
        </div>
        <div>
          <label htmlFor="confirm" className="field-label">Confirm password</label>
          <PasswordInput id="confirm" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" invalid={Boolean(errors.confirm)} />
          {errors.confirm && <p className="field-error">{errors.confirm}</p>}
        </div>
        {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}

function ResetRequest({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    setError('');
    try {
      await auth.requestPasswordReset(email);
      setState('sent');
    } catch (err) {
      setError(userMessage(err));
      setState('idle');
    }
  };
  if (state === 'sent') {
    return <p className="mt-3 rounded-md border border-line bg-ivory p-4 text-sm text-stone" role="status">If that email belongs to an administrator, a reset link is on its way. It works for one hour.</p>;
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-line bg-ivory p-4" noValidate>
      <label htmlFor="reset-email" className="field-label">Email for the reset link</label>
      <input id="reset-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn btn-outline btn-sm" disabled={!email || state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Email me a reset link'}</button>
    </form>
  );
}

/** Landing page for the reset link (Supabase only). */
export function ResetPassword() {
  useHead({ title: 'Choose a new password', noindex: true });
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) { setError('The passwords don’t match.'); return; }
    setBusy(true);
    setError('');
    try {
      await auth.updatePassword(pw);
      await refresh();
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Choose a new password" intro="Use at least 12 characters, with letters and numbers.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="new-pw" className="field-label">New password</label>
          <PasswordInput id="new-pw" value={pw} onChange={setPw} autoComplete="new-password" invalid={Boolean(error)} />
        </div>
        <div>
          <label htmlFor="confirm-pw" className="field-label">Confirm password</label>
          <PasswordInput id="confirm-pw" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={Boolean(error)} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !pw}>{busy ? 'Saving…' : 'Save password and sign in'}</button>
      </form>
    </AuthShell>
  );
}
