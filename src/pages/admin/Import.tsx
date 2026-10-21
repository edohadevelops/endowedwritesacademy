import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, FolderUp, Download, AlertTriangle, ImageIcon, Info } from 'lucide-react';
import { importer, taxonomy, userMessage, backend } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { useSite } from '@/context/SiteContext';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/layout/AdminLayout';
import { formatDate } from '@/lib/utils/format';
import { ACCEPTED, missingImages, type ImportCandidate } from '@/features/import/sources';
import type { ImportResult } from '@/features/import/run';

interface Row { c: ImportCandidate; include: boolean; title: string; status: 'draft' | 'published'; category: string }

const FORMATS = [
  ['Word', '.docx files. Headings, lists, links and images come across.'],
  ['Markdown', '.md files. Optional front matter: title, date, category, tags, summary, status, image. $…$ and $$…$$ become equations.'],
  ['Spreadsheet', '.csv with one article per row. Download the template below.'],
  ['Blogger', 'The .xml backup from Blogger → Settings → Back up content. Comments come too.'],
  ['Web pages', '.html files, such as articles saved from another site.'],
  ['Import bundle', '.json made by the bundle script, or a list of articles.'],
] as const;

export default function Import() {
  const toast = useToast();
  const { settings } = useSite();
  const cats = useAsync(() => taxonomy.categories(), [], ['categories']);
  const existing = useAsync(() => importer.existingImportSlugs(), [], ['posts']);
  const [rows, setRows] = useState<Row[]>([]);
  const [images, setImages] = useState<Map<string, File>>(new Map());
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<'file' | 'draft' | 'published'>('file');
  const [defaultCategory, setDefaultCategory] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const doExport = async () => {
    setExporting({ done: 0, total: 0 });
    try {
      const { exportAll, downloadJson } = await import('@/features/import/export');
      const data = await exportAll((done, total) => setExporting({ done, total }));
      downloadJson(data, `endowed-academy-export-${new Date().toISOString().slice(0, 10)}.json`);
      toast(`Exported ${data.posts.length} article${data.posts.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast(userMessage(e, 'The export failed. Try again.'), 'error');
    } finally {
      setExporting(null);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => !f.name.startsWith('.'));
    if (!files.length) return;
    setReading(true);
    setResult(null);
    try {
      const { parseFiles } = await import('@/features/import/sources');
      const parsed = await parseFiles(files);
      setImages((prev) => new Map([...prev, ...parsed.images]));
      setErrors((prev) => [...prev, ...parsed.errors]);
      setRows((prev) => [
        ...prev,
        ...parsed.candidates.map((c) => ({
          c, include: true, title: c.title,
          status: (c.fileStatus ?? 'draft') as 'draft' | 'published',
          category: c.category ?? '',
        })),
      ]);
    } finally {
      setReading(false);
    }
  };

  const status = (r: Row): 'draft' | 'published' => (defaultStatus === 'file' ? r.status : defaultStatus);
  const category = (r: Row) => r.category || defaultCategory || null;
  const dup = (r: Row) => existing.data?.has(r.c.slug) ?? false;
  const selected = rows.filter((r) => r.include && !dup(r));
  const imageCount = images.size;
  const catNames = useMemo(() => {
    const names = new Set((cats.data ?? []).map((c) => c.name));
    rows.forEach((r) => r.category && names.add(r.category));
    return [...names].sort();
  }, [cats.data, rows]);

  const run = async () => {
    setProgress({ done: 0, total: selected.length });
    try {
      const { runImport } = await import('@/features/import/run');
      const res = await runImport(
        selected.map((r) => ({ candidate: r.c, title: r.title.trim() || 'Untitled', status: status(r), categoryName: category(r) })),
        images, settings.defaultAuthorName, (done, total) => setProgress({ done, total }),
      );
      setResult(res);
      toast(`Imported ${res.imported} article${res.imported === 1 ? '' : 's'}`);
      setRows([]);
      setImages(new Map());
      setErrors([]);
    } catch (e) {
      toast(userMessage(e, 'The import stopped part way. Articles already imported are kept.'), 'error');
    } finally {
      setProgress(null);
    }
  };

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.c.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <PageHeader title="Import articles" tour="import" description="Bring in older articles in bulk. Nothing goes live until you choose." />

      {result && (
        <div className="mb-8 rounded-md border border-success/30 bg-success/5 p-5" role="status">
          <p className="font-serif text-xl">Imported {result.imported} article{result.imported === 1 ? '' : 's'}.</p>
          {result.skipped.length > 0 && <p className="mt-2 text-sm text-stone">Skipped: {result.skipped.join('; ')}.</p>}
          {result.imageFailures.length > 0 && <p className="mt-2 text-sm text-warn">Some images couldn’t be added: {result.imageFailures.join('; ')}.</p>}
          <Link to="/admin/posts" className="btn btn-outline btn-sm mt-4">Review them in Articles</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <div
            data-tour="import-drop"
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-accent bg-accent/5' : 'border-line bg-paper'}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
          >
            <FileUp className="mx-auto h-8 w-8 text-stone" aria-hidden />
            <p className="mt-3 font-serif text-xl">Drop files here</p>
            <p className="mt-1 text-sm text-stone">Word, Markdown, CSV, Blogger backup, HTML or an import bundle, plus any images they use.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <input ref={fileRef} type="file" multiple accept={ACCEPTED} className="sr-only" tabIndex={-1} aria-hidden
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
              <input ref={folderRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={reading} data-tip="Pick one or more files">
                <FileUp className="h-4 w-4" aria-hidden />Choose files
              </button>
              <button className="btn btn-outline" onClick={() => folderRef.current?.click()} disabled={reading} data-tip="Pick a whole folder of articles and images">
                <FolderUp className="h-4 w-4" aria-hidden />Choose a folder
              </button>
            </div>
            {reading && <p className="mt-4 text-sm text-stone" role="status">Reading files…</p>}
          </div>

          {errors.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          {rows.length > 0 && (
            <section aria-labelledby="review-h" className="mt-8" data-tour="import-review">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="review-h" className="font-serif text-2xl font-medium">Review {rows.length} article{rows.length === 1 ? '' : 's'}</h2>
                  <p className="mt-1 text-sm text-stone">
                    Untick anything you don’t want. You can fix titles, status and category here, and everything else after importing.
                    {imageCount > 0 && <> <ImageIcon className="mb-0.5 inline h-3.5 w-3.5" aria-hidden /> {imageCount} image file{imageCount === 1 ? '' : 's'} added.</>}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setRows([]); setImages(new Map()); setErrors([]); }} data-tip="Clear the list and start again">Clear list</button>
              </div>

              <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-paper">
                {rows.map((r) => {
                  const isDup = dup(r);
                  const missing = missingImages(r.c, images);
                  const warnings = [...r.c.warnings, ...(missing.length ? [`${missing.length} image${missing.length > 1 ? 's' : ''} not found (${missing.slice(0, 3).join(', ')}). Add those files to include them.`] : [])];
                  return (
                    <li key={r.c.key} className={`grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)] ${isDup ? 'opacity-60' : ''}`}>
                      <input type="checkbox" className="mt-2.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={r.include && !isDup} disabled={isDup}
                        onChange={(e) => update(r.c.key, { include: e.target.checked })} aria-label={`Import ${r.title}`} />
                      <div className="min-w-0 space-y-2">
                        <label className="sr-only" htmlFor={`t-${r.c.key}`}>Title</label>
                        <input id={`t-${r.c.key}`} className="input font-medium" value={r.title} onChange={(e) => update(r.c.key, { title: e.target.value })} />
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <label className="sr-only" htmlFor={`s-${r.c.key}`}>Status</label>
                          <select id={`s-${r.c.key}`} className="input w-auto py-1" value={status(r)} disabled={defaultStatus !== 'file'}
                            onChange={(e) => update(r.c.key, { status: e.target.value as Row['status'] })} data-tip="Draft stays private. Published goes live with its original date.">
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                          </select>
                          <label className="sr-only" htmlFor={`c-${r.c.key}`}>Category</label>
                          <select id={`c-${r.c.key}`} className="input w-auto py-1" value={r.category} onChange={(e) => update(r.c.key, { category: e.target.value })}>
                            <option value="">{defaultCategory ? `Default (${defaultCategory})` : 'No category'}</option>
                            {catNames.map((n) => <option key={n} value={n}>{n}{cats.data?.some((c) => c.name === n) ? '' : ' (new)'}</option>)}
                          </select>
                          <span className="text-stone">{r.c.publishedAt ? formatDate(r.c.publishedAt) : 'No date'}</span>
                          <span className="truncate text-xs text-stone">from {r.c.source}</span>
                        </div>
                        {isDup && <p className="text-xs font-semibold text-warn">Already on the site (/blog/{r.c.slug}). It will be skipped.</p>}
                        {warnings.map((w, i) => <p key={i} className="flex gap-1.5 text-xs text-warn"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{w}</p>)}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="sticky bottom-0 -mx-4 mt-4 flex flex-wrap items-center gap-3 border-t border-line bg-ivory/95 px-4 py-4 backdrop-blur md:mx-0 md:px-0">
                <button className="btn btn-primary" disabled={!selected.length || Boolean(progress)} onClick={run} data-tour="import-run"
                  data-tip="Add the ticked articles. Images are added to Media.">
                  {progress ? `Importing ${progress.done} of ${progress.total}…` : `Import ${selected.length} article${selected.length === 1 ? '' : 's'}`}
                </button>
                {progress && (
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Import progress">
                    <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-md border border-line bg-paper p-5" data-tour="import-defaults">
            <h2 className="font-semibold">Defaults</h2>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <label htmlFor="def-status" className="field-label">Status</label>
                <select id="def-status" className="input" value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value as typeof defaultStatus)}>
                  <option value="file">As in each file (draft if not stated)</option>
                  <option value="draft">All as drafts</option>
                  <option value="published">All published</option>
                </select>
                <p className="field-hint">Drafts let you check each article before it goes live.</p>
              </div>
              <div>
                <label htmlFor="def-cat" className="field-label">Category when a file has none</label>
                <select id="def-cat" className="input" value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
                  <option value="">No category</option>
                  {(cats.data ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-line bg-paper p-5">
            <h2 className="font-semibold">What can be imported</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {FORMATS.map(([k, v]) => (
                <div key={k}><dt className="font-medium">{k}</dt><dd className="text-stone">{v}</dd></div>
              ))}
            </dl>
            <a href="/import-template.csv" download className="btn btn-outline btn-sm mt-4" data-tour="import-template" data-tip="A spreadsheet with the columns the importer understands">
              <Download className="h-4 w-4" aria-hidden />Spreadsheet template
            </a>
            <a href="/import-example.md" download className="btn btn-ghost btn-sm mt-2" data-tip="An example Markdown article with front matter">
              <Download className="h-4 w-4" aria-hidden />Markdown example
            </a>
          </section>

          <section className="rounded-md border border-line bg-paper p-5" data-tour="import-export">
            <h2 className="font-semibold">Export everything</h2>
            <p className="mt-2 text-sm text-stone">
              Download every article, with its images and approved comments, as one file. Import it here on another site, or keep it as a backup.
              {!backend.shared && ' Use this to move what you wrote in this preview into the live site.'}
            </p>
            <button className="btn btn-outline btn-sm mt-4" disabled={Boolean(exporting)} onClick={doExport} data-tip="Downloads a .json file you can import later">
              <Download className="h-4 w-4" aria-hidden />{exporting ? `Exporting ${exporting.done} of ${exporting.total}…` : 'Export all articles'}
            </button>
          </section>

          <p className="flex gap-2 text-xs leading-relaxed text-stone">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Articles whose web address already exists are skipped, so running the same import twice won’t create copies.
          </p>
        </aside>
      </div>
    </>
  );
}
