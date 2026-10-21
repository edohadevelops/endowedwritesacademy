import { useRef, useState } from 'react';
import { Upload, Search, Check } from 'lucide-react';
import { adminMedia, userMessage } from '@/lib/data';
import { useAsync, useDebounced } from '@/lib/hooks';
import type { MediaAsset } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { MEDIA_RULES } from '@/lib/data/media';

export function useUploader() {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const upload = async (files: FileList | File[]): Promise<MediaAsset[]> => {
    setError('');
    const out: MediaAsset[] = [];
    for (const f of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        out.push(await adminMedia.upload(f));
      } catch (e) {
        setError(`${f.name}: ${userMessage(e, 'Upload failed. Try again.')}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    return out;
  };
  return { upload, uploading, error, setError };
}

export function UploadButton({ onUploaded, label = 'Upload image', multiple = false, className = 'btn btn-outline', tour }: {
  onUploaded: (assets: MediaAsset[]) => void; label?: string; multiple?: boolean; className?: string; tour?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { upload, uploading, error } = useUploader();
  return (
    <div>
      <input ref={ref} type="file" accept={MEDIA_RULES.accepted.join(',')} multiple={multiple} className="sr-only" tabIndex={-1} aria-hidden
        onChange={async (e) => { if (e.target.files?.length) onUploaded(await upload(e.target.files)); e.target.value = ''; }} />
      <button type="button" className={className} onClick={() => ref.current?.click()} disabled={uploading > 0} data-tour={tour} data-tip="JPG, PNG, WebP, AVIF or GIF, up to 8 MB">
        <Upload className="h-4 w-4" aria-hidden /> {uploading ? 'Uploading…' : label}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

/** Choose an image from the library, or upload a new one. */
export function MediaPicker({ open, onClose, onPick, title = 'Choose an image' }: {
  open: boolean; onClose: () => void; onPick: (asset: MediaAsset) => void; title?: string;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [chosen, setChosen] = useState<MediaAsset | null>(null);
  const [alt, setAlt] = useState('');
  const { data, loading } = useAsync(() => (open ? adminMedia.list(dq) : Promise.resolve([])), [open, dq], ['media']);
  const [dragOver, setDragOver] = useState(false);
  const { upload, uploading, error } = useUploader();

  const select = (a: MediaAsset) => { setChosen(a); setAlt(a.alt); };
  const confirm = async () => {
    if (!chosen) return;
    if (alt !== chosen.alt) await adminMedia.updateMeta(chosen.id, { alt, caption: chosen.caption });
    onPick({ ...chosen, alt });
    setChosen(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { setChosen(null); onClose(); }} title={title} size="xl"
      footer={
        <>
          <button className="btn btn-outline" onClick={() => { setChosen(null); onClose(); }}>Cancel</button>
          <button className="btn btn-primary" disabled={!chosen} onClick={confirm}>Use this image</button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <label htmlFor="media-q" className="sr-only">Search images</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" aria-hidden />
              <input id="media-q" className="input pl-9" placeholder="Search by file name or description" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <UploadButton onUploaded={(a) => a[0] && select(a[0])} />
          </div>
          <div
            className={`mt-4 min-h-64 rounded-md border-2 border-dashed p-3 transition-colors ${dragOver ? 'border-accent bg-accent/5' : 'border-transparent'}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={async (e) => { e.preventDefault(); setDragOver(false); const a = await upload(e.dataTransfer.files); if (a[0]) select(a[0]); }}
          >
            {uploading > 0 && <p className="mb-3 text-sm text-stone" role="status">Uploading {uploading} image{uploading > 1 ? 's' : ''}…</p>}
            {error && <p className="field-error mb-3" role="alert">{error}</p>}
            {loading && !data ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-square" />)}</div>
            ) : data && data.length === 0 ? (
              <div className="grid h-56 place-items-center text-center text-stone">
                <p>{dq ? 'No images match.' : 'No images yet. Upload one, or drop files here.'}</p>
              </div>
            ) : (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {(data ?? []).map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => select(m)} aria-pressed={chosen?.id === m.id}
                      className={`relative block aspect-square w-full overflow-hidden rounded bg-line ring-offset-2 ${chosen?.id === m.id ? 'ring-2 ring-accent' : 'hover:opacity-90'}`}>
                      <img src={m.url} alt={m.alt || m.filename} className="h-full w-full object-cover" loading="lazy" />
                      {chosen?.id === m.id && <span className="absolute right-1.5 top-1.5 rounded-full bg-accent p-1 text-white"><Check className="h-3 w-3" /></span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          {chosen ? (
            <div className="space-y-4">
              <img src={chosen.url} alt="" className="w-full rounded bg-line" />
              <p className="break-all text-xs text-stone">{chosen.filename} · {chosen.width}×{chosen.height}</p>
              <div>
                <label htmlFor="pick-alt" className="field-label">Alt text</label>
                <textarea id="pick-alt" className="input min-h-20" value={alt} onChange={(e) => setAlt(e.target.value)} />
                <p className="field-hint">Describe the image for people who can’t see it. Leave empty only if it’s purely decorative.</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone">Select an image to see its details.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
