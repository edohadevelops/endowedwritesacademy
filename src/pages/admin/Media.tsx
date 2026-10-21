import { useEffect, useRef, useState } from 'react';
import { Search, Copy } from 'lucide-react';
import { adminMedia, userMessage } from '@/lib/data';
import { useAsync, useDebounced } from '@/lib/hooks';
import type { MediaAsset } from '@/lib/types';
import { PageHeader } from '@/components/layout/AdminLayout';
import { UploadButton, useUploader } from '@/components/admin/MediaPicker';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatBytes, formatDate } from '@/lib/utils/format';
import { MEDIA_RULES } from '@/lib/data/media';

export default function Media() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const { data, loading } = useAsync(() => adminMedia.list(dq), [dq], ['media']);
  const [open, setOpen] = useState<MediaAsset | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const { upload, uploading, error } = useUploader();

  return (
    <>
      <PageHeader title="Media" tour="media" description={`Images for articles and the site. JPG, PNG, WebP, AVIF or GIF up to ${MEDIA_RULES.maxBytes / 1024 / 1024} MB.`}
        actions={<UploadButton multiple tour="media-upload" label="Upload images" className="btn btn-primary" onUploaded={(a) => a.length && toast(`Uploaded ${a.length} image${a.length > 1 ? 's' : ''}`)} />} />
      <div className="relative max-w-md" data-tour="media-search">
        <label htmlFor="mq" className="sr-only">Search images</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" aria-hidden />
        <input id="mq" className="input pl-9" placeholder="Search by file name or alt text" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className={`mt-6 rounded-md border-2 border-dashed p-2 transition-colors ${dragOver ? 'border-accent bg-accent/5' : 'border-transparent'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => { e.preventDefault(); setDragOver(false); const a = await upload(e.dataTransfer.files); if (a.length) toast(`Uploaded ${a.length}`); }}>
        {uploading > 0 && <p className="mb-3 text-sm text-stone" role="status">Uploading…</p>}
        {error && <p className="field-error mb-3" role="alert">{error}</p>}
        {loading && !data ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton aspect-square" />)}</div>
        ) : data?.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-md bg-paper text-center">
            <div><p className="font-serif text-xl">{dq ? 'No images match.' : 'No images yet.'}</p><p className="mt-1 text-sm text-stone">Upload images here, or drag them onto this area.</p></div>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-tour="media-grid">
            {(data ?? []).map((m) => (
              <li key={m.id}>
                <button onClick={() => setOpen(m)} data-tip="Edit alt text, see where it’s used, replace or delete" className="group block w-full text-left">
                  <span className="block aspect-square overflow-hidden rounded bg-line">
                    <img src={m.url} alt={m.alt || ''} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                  </span>
                  <span className="mt-1.5 block truncate text-xs text-stone">{m.filename}</span>
                  {!m.alt && <span className="block text-xs font-medium text-warn">Needs alt text</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <MediaDetails asset={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function MediaDetails({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const toast = useToast();
  const [alt, setAlt] = useState(asset.alt);
  const [caption, setCaption] = useState(asset.caption);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const usage = useAsync(() => adminMedia.usage(asset.id), [asset.id]);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(asset);
  useEffect(() => setCurrent(asset), [asset]);

  const save = async () => {
    setBusy(true);
    try { await adminMedia.updateMeta(asset.id, { alt, caption }); toast('Image details saved'); onClose(); }
    catch (e) { toast(userMessage(e), 'error'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    try { await adminMedia.remove(asset.id); toast('Image deleted'); onClose(); }
    catch (e) { toast(userMessage(e), 'error'); setConfirm(false); }
  };

  return (
    <Modal open onClose={onClose} title="Image details" size="lg"
      footer={<>
        <button className="btn btn-ghost mr-auto text-danger" onClick={() => setConfirm(true)}>Delete</button>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>Save details</button>
      </>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <img src={current.url} alt="" className="w-full rounded bg-line" />
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-stone">
            <dt>File</dt><dd className="break-all">{current.filename}</dd>
            <dt>Size</dt><dd>{current.width} × {current.height}, {formatBytes(current.sizeBytes)}</dd>
            <dt>Uploaded</dt><dd>{formatDate(current.createdAt)}</dd>
          </dl>
        </div>
        <div className="space-y-4">
          <div>
            <label htmlFor="d-alt" className="field-label">Alt text</label>
            <textarea id="d-alt" className="input min-h-20" value={alt} onChange={(e) => setAlt(e.target.value)} />
            <p className="field-hint">Used whenever this image is inserted from now on.</p>
          </div>
          <div>
            <label htmlFor="d-cap" className="field-label">Default caption</label>
            <input id="d-cap" className="input" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div>
            <p className="field-label">Used in</p>
            {usage.data?.length ? (
              <ul className="list-disc space-y-1 pl-5 text-sm">{usage.data.map((u) => <li key={u.id}>{u.title}</li>)}</ul>
            ) : <p className="text-sm text-stone">Not used anywhere yet.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={replaceRef} type="file" accept={MEDIA_RULES.accepted.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try { setCurrent(await adminMedia.replace(asset.id, f)); toast('Image replaced everywhere it’s used'); }
              catch (err) { toast(userMessage(err), 'error'); }
            }} />
            <button className="btn btn-outline btn-sm" data-tip="Upload a new file; every article using this image updates" onClick={() => replaceRef.current?.click()}>Replace file</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(current.url); toast('Image address copied'); }}><Copy className="h-3.5 w-3.5" />Copy address</button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} danger title="Delete this image?"
        body={usage.data?.length ? 'It’s still used, so it can’t be deleted until you remove it from those articles.' : 'It isn’t used anywhere. Deleting it is permanent.'}
        confirmLabel="Delete image" onConfirm={remove} />
    </Modal>
  );
}
