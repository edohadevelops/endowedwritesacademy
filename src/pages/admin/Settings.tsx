import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { settings as settingsApi, auth, AppError, userMessage } from '@/lib/data';
import type { SiteSettings, NavLink, SocialLink } from '@/lib/types';
import { useSite, applyBrand } from '@/context/SiteContext';
import { PageHeader } from '@/components/layout/AdminLayout';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { onboarding } from '@/features/onboarding/store';
import { Link } from 'react-router-dom';
import { useToast } from '@/components/ui/Toast';
import { LogoMark } from '@/components/ui/Logo';
import { contrastRatio } from '@/lib/utils/format';
import { DEFAULT_SETTINGS } from '@/config/defaults';

const TABS = [
  { key: 'brand', label: 'Brand', tip: 'Name, logo, colour and text style' },
  { key: 'home', label: 'Blog home', tip: 'Headline, introduction and call to action' },
  { key: 'menus', label: 'Menus & footer', tip: 'Menu links, social links, contact email' },
  { key: 'comments', label: 'Comments', tip: 'Turn comments on or off and set the rules' },
  { key: 'seo', label: 'Search', tip: 'Site address and default search description' },
  { key: 'account', label: 'Account', tip: 'Password and help settings' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function LinkList<T extends NavLink | SocialLink>({ items, onChange, errors, prefix, addLabel }: {
  items: T[]; onChange: (v: T[]) => void; errors: Record<string, string>; prefix: string; addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((l, i) => (
        <div key={i}>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`${prefix}-l-${i}`}>Name</label>
            <input id={`${prefix}-l-${i}`} className="input w-36 shrink-0" placeholder="Name" value={l.label} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <label className="sr-only" htmlFor={`${prefix}-u-${i}`}>Link</label>
            <input id={`${prefix}-u-${i}`} className="input" placeholder="https:// or /page" value={l.url} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <button type="button" className="rounded p-2 text-stone hover:bg-danger/10 hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${l.label || 'link'}`}><Trash2 className="h-4 w-4" /></button>
          </div>
          {errors[`${prefix}.${i}`] && <p className="field-error">{errors[`${prefix}.${i}`]}</p>}
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange([...items, { label: '', url: '' } as T])}><Plus className="h-4 w-4" />{addLabel}</button>
    </div>
  );
}

export default function Settings() {
  const { settings, logoUrl, refresh } = useSite();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'brand';
  const [s, setS] = useState<SiteSettings>(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(logoUrl);
  useEffect(() => { setS(settings); setLogoPreview(logoUrl); }, [settings, logoUrl]);

  // Live preview of brand colour/type; reverted if the page is left unsaved.
  useEffect(() => { applyBrand(s); }, [s.accentColor, s.typePreset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => applyBrand(settings), [settings]);

  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const up = (patch: Partial<SiteSettings>) => setS((x) => ({ ...x, ...patch }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await settingsApi.save({ ...s, comments: { ...s.comments, blockedTerms: s.comments.blockedTerms.map((t) => t.trim()).filter(Boolean) } });
      await refresh();
      toast('Settings saved');
    } catch (err) {
      if (err instanceof AppError && err.fields) setErrors(err.fields);
      toast(userMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const contrast = contrastRatio(s.accentColor, '#FFFFFF');
  const showSave = tab !== 'account';

  return (
    <>
      <PageHeader title="Settings" tour="settings" description="Control how the blog looks and behaves. No code needed." />
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div role="tablist" aria-label="Settings sections" className="flex min-w-max gap-1 border-b border-line" data-tour="settings-tabs">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} data-tip={t.tip} onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t.key ? 'border-accent text-ink' : 'border-transparent text-stone hover:text-ink'}`}>{t.label}</button>
          ))}
        </div>
      </div>

      <form onSubmit={save} className="mt-8 max-w-2xl space-y-6" noValidate data-tour={tab === 'brand' ? 'settings-brand' : undefined}>
        {tab === 'brand' && (
          <>
            <Field id="name" label="Academy name" error={errors.siteName}>
              <input id="name" className="input" value={s.siteName} onChange={(e) => up({ siteName: e.target.value })} />
            </Field>
            <Field id="tagline" label="Tagline" hint="A short line used in the footer and search results.">
              <input id="tagline" className="input" value={s.tagline} onChange={(e) => up({ tagline: e.target.value })} />
            </Field>
            <div>
              <p className="field-label">Logo</p>
              <div className="flex items-center gap-4">
                <div className="grid h-16 w-40 place-items-center rounded border border-line bg-obsidian p-2">
                  {logoPreview && s.logoMediaId ? <img src={logoPreview} alt="Current logo" className="max-h-12 max-w-full object-contain" /> : <LogoMark className="h-10 w-10" />}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicker(true)}>Choose logo</button>
                  {s.logoMediaId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => up({ logoMediaId: null })}>Use the built-in mark</button>}
                </div>
              </div>
              <p className="field-hint">Shown on the dark header, so use a light or transparent logo. Without one, the built-in mark and name are used.</p>
            </div>
            <Field id="accent" label="Accent colour" error={errors.accentColor} hint={`Buttons and links. Contrast with white text: ${contrast.toFixed(1)}:1 ${contrast >= 4.5 ? '(readable)' : '(too low, needs 4.5)'}`}>
              <div className="flex items-center gap-3">
                <input type="color" aria-label="Pick accent colour" className="h-10 w-14 cursor-pointer rounded border border-line bg-paper p-1" value={s.accentColor} onChange={(e) => up({ accentColor: e.target.value.toUpperCase() })} />
                <input id="accent" className="input w-32 font-mono" value={s.accentColor} onChange={(e) => up({ accentColor: e.target.value })} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => up({ accentColor: DEFAULT_SETTINGS.accentColor })}>Reset</button>
              </div>
            </Field>
            <div className="rounded-md border border-line bg-paper p-5" aria-label="Preview">
              <p className="text-xs font-semibold text-stone">Preview</p>
              <p className="mt-2 font-serif text-2xl">How to build a study routine</p>
              <p className={`mt-1 ${s.typePreset === 'modern' ? 'font-sans' : 'font-serif'} text-[1.05rem] leading-relaxed`}>Article text looks like this, with <a className="text-accent-strong underline underline-offset-4">a link</a> in the accent colour.</p>
              <button type="button" className="btn btn-primary mt-4">Primary button</button>
            </div>
            <fieldset>
              <legend className="field-label">Article text style</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {([['editorial', 'Editorial', 'Serif body text, like a printed journal.'], ['modern', 'Modern', 'Sans-serif body text, crisp on small screens.']] as const).map(([k, l, d]) => (
                  <label key={k} className={`cursor-pointer rounded-md border p-4 ${s.typePreset === k ? 'border-accent ring-2 ring-accent/20' : 'border-line'}`}>
                    <input type="radio" name="type" className="sr-only" checked={s.typePreset === k} onChange={() => up({ typePreset: k })} />
                    <span className={`block text-lg ${k === 'editorial' ? 'font-serif' : 'font-sans font-medium'}`}>{l}</span>
                    <span className="mt-1 block text-sm text-stone">{d}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={s.showDropCap} onChange={(e) => up({ showDropCap: e.target.checked })} />
              <span>Start articles with a large first letter</span>
            </label>
          </>
        )}

        {tab === 'home' && (
          <>
            <Field id="hero-t" label="Headline" hint="The large line at the top of the blog home.">
              <input id="hero-t" className="input" value={s.heroTitle} onChange={(e) => up({ heroTitle: e.target.value })} />
            </Field>
            <Field id="hero-i" label="Introduction">
              <textarea id="hero-i" className="input min-h-24" value={s.heroIntro} onChange={(e) => up({ heroIntro: e.target.value })} />
            </Field>
            <p className="text-sm text-stone">The featured article is chosen per article: open it and tick “Feature on the blog home”, or use the article menu in Articles.</p>
            <fieldset className="space-y-4 rounded-md border border-line p-5">
              <legend className="px-1 text-sm font-semibold">Call to action</legend>
              <p className="text-sm text-stone">Shown at the bottom of the blog home, and used as the default when you insert a call-to-action box in an article.</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={Boolean(s.cta)} onChange={(e) => up({ cta: e.target.checked ? (settings.cta ?? DEFAULT_SETTINGS.cta) : null })} />
                Show the call to action
              </label>
              {s.cta && (
                <>
                  <Field id="cta-t" label="Heading"><input id="cta-t" className="input" value={s.cta.title} onChange={(e) => up({ cta: { ...s.cta!, title: e.target.value } })} /></Field>
                  <Field id="cta-x" label="Text"><textarea id="cta-x" className="input min-h-20" value={s.cta.text} onChange={(e) => up({ cta: { ...s.cta!, text: e.target.value } })} /></Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="cta-l" label="Button text"><input id="cta-l" className="input" value={s.cta.label} onChange={(e) => up({ cta: { ...s.cta!, label: e.target.value } })} /></Field>
                    <Field id="cta-h" label="Button link" error={errors.ctaHref}><input id="cta-h" className="input" value={s.cta.href} onChange={(e) => up({ cta: { ...s.cta!, href: e.target.value } })} /></Field>
                  </div>
                </>
              )}
            </fieldset>
          </>
        )}

        {tab === 'menus' && (
          <>
            <div>
              <p className="field-label">Main menu</p>
              <p className="field-hint mb-3 mt-0">Links in the header and footer. About, Courses and Contact open a “coming soon” page until those pages are built.</p>
              <LinkList items={s.navLinks} onChange={(navLinks) => up({ navLinks })} errors={errors} prefix="nav" addLabel="Add menu link" />
            </div>
            <div>
              <p className="field-label">Social media</p>
              <p className="field-hint mb-3 mt-0">Shown in the footer. Leave empty to hide.</p>
              <LinkList items={s.socialLinks} onChange={(socialLinks) => up({ socialLinks })} errors={errors} prefix="social" addLabel="Add social link" />
            </div>
            <Field id="email" label="Contact email" error={errors.contactEmail} hint="Shown in the footer when filled in.">
              <input id="email" type="email" className="input" value={s.contactEmail} onChange={(e) => up({ contactEmail: e.target.value })} />
            </Field>
            <Field id="footer" label="Footer note">
              <input id="footer" className="input" value={s.footerText} onChange={(e) => up({ footerText: e.target.value })} />
            </Field>
            <Field id="author" label="Default author name" hint="Used for new articles.">
              <input id="author" className="input" value={s.defaultAuthorName} onChange={(e) => up({ defaultAuthorName: e.target.value })} />
            </Field>
          </>
        )}

        {tab === 'comments' && (
          <>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={s.comments.enabled} onChange={(e) => up({ comments: { ...s.comments, enabled: e.target.checked } })} />
              <span><span className="font-medium">Allow comments on articles</span><span className="block text-stone">You can also turn comments off for a single article in the editor.</span></span>
            </label>
            <fieldset>
              <legend className="field-label">Approval</legend>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2.5"><input type="radio" name="mod" className="mt-1 accent-[rgb(var(--accent))]" checked={s.comments.moderation === 'all'} onChange={() => up({ comments: { ...s.comments, moderation: 'all' } })} />
                  <span><span className="font-medium">Approve every comment</span><span className="block text-stone">Nothing appears until you approve it. Recommended.</span></span></label>
                <label className="flex items-start gap-2.5"><input type="radio" name="mod" className="mt-1 accent-[rgb(var(--accent))]" checked={s.comments.moderation === 'flagged'} onChange={() => up({ comments: { ...s.comments, moderation: 'flagged' } })} />
                  <span><span className="font-medium">Only review flagged comments</span><span className="block text-stone">Comments that pass the automatic checks appear straight away.</span></span></label>
              </div>
            </fieldset>
            <Field id="blocked" label="Blocked words" hint="One per line. Comments containing these, including disguised spellings like “b@d”, go to review. A short built-in list of slurs is always checked.">
              <textarea id="blocked" className="input min-h-32 font-mono text-sm" value={s.comments.blockedTerms.join('\n')} onChange={(e) => up({ comments: { ...s.comments, blockedTerms: e.target.value.split('\n') } })} />
            </Field>
          </>
        )}

        {tab === 'seo' && (
          <>
            <Field id="url" label="Site address" error={errors.siteUrl} hint="The public address once the site is live, e.g. https://endowedacademy.com. Used for share links and search engines.">
              <input id="url" className="input" placeholder="https://" value={s.seo.siteUrl} onChange={(e) => up({ seo: { ...s.seo, siteUrl: e.target.value.replace(/\/+$/, '') } })} />
            </Field>
            <Field id="desc" label="Default description" hint="Used when a page has no description of its own. About 150 characters.">
              <textarea id="desc" className="input min-h-24" value={s.seo.defaultDescription} onChange={(e) => up({ seo: { ...s.seo, defaultDescription: e.target.value } })} />
            </Field>
          </>
        )}

        {showSave && (
          <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-line bg-ivory/95 px-4 py-4 backdrop-blur md:mx-0 md:px-0" data-tour="settings-save">
            <button className="btn btn-primary" disabled={busy || !dirty} data-tip="Apply these changes to the live blog">{busy ? 'Saving…' : 'Save settings'}</button>
            {dirty && <button type="button" className="btn btn-ghost" data-tip="Undo everything since your last save" onClick={() => { setS(settings); setErrors({}); }}>Discard changes</button>}
            {dirty && <span className="text-sm text-stone">Unsaved changes</span>}
          </div>
        )}
      </form>

      {tab === 'account' && <AccountPanel />}

      <MediaPicker open={picker} onClose={() => setPicker(false)} title="Choose a logo" onPick={(a) => { up({ logoMediaId: a.id }); setLogoPreview(a.url); }} />
    </>
  );
}

function AccountPanel() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      await auth.changePassword(cur, next);
      setCur(''); setNext('');
      toast('Password changed');
    } catch (err) {
      setErrors(err instanceof AppError && err.fields ? err.fields : { form: userMessage(err) });
    }
  };
  return (
    <div className="mt-8 max-w-md space-y-12">
    <HelpPanel />
    <form onSubmit={submit} className="space-y-5" noValidate>
      <h2 className="font-serif text-2xl">Change password</h2>
      <Field id="cur" label="Current password" error={errors.current}>
        <input id="cur" type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
      </Field>
      <Field id="new" label="New password" error={errors.next} hint="At least 12 characters, with letters and numbers.">
        <input id="new" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      {errors.form && <p className="field-error">{errors.form}</p>}
      <button className="btn btn-primary" disabled={!cur || !next}>Change password</button>
    </form>
    </div>
  );
}

function HelpPanel() {
  const toast = useToast();
  const [tipsOn, setTipsOn] = useState(onboarding.tipsOn());
  return (
    <section aria-labelledby="help-h" className="space-y-4">
      <h2 id="help-h" className="font-serif text-2xl">Help and tips</h2>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={tipsOn}
          onChange={(e) => { onboarding.setTipsOn(e.target.checked); setTipsOn(e.target.checked); }} />
        <span><span className="font-medium">Show tips when hovering over buttons</span><span className="block text-stone">A short explanation appears when you point at, or tab to, any action.</span></span>
      </label>
      <div>
        <button type="button" className="btn btn-outline" onClick={() => { onboarding.resetTours(); toast('Page tours will show again the next time you open each page'); }}>
          Show all page tours again
        </button>
        <p className="field-hint">Each admin page has a short guided tour. Press the question mark on any page to replay just that one.</p>
      </div>
      <p className="text-sm text-stone">Bringing in older articles? Use <Link to="/admin/import" className="font-medium text-accent-strong underline underline-offset-4">Import articles</Link>.</p>
    </section>
  );
}
