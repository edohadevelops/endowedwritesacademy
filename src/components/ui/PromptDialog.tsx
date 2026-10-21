import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';

export interface PromptField { name: string; label: string; hint?: string; multiline?: boolean; placeholder?: string; initial?: string }

/** A small form-in-a-dialog for link URLs, equations and embeds. */
export function PromptDialog({
  open, title, fields, submitLabel, onClose, onSubmit, validate, extraAction,
}: {
  open: boolean;
  title: string;
  fields: PromptField[];
  submitLabel: string;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  validate?: (values: Record<string, string>) => string | null;
  extraAction?: { label: string; onClick: () => void };
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setValues(Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = validate?.(values) ?? null;
    if (problem) { setError(problem); return; }
    onSubmit(values);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <form onSubmit={submit} className="space-y-4">
        {fields.map((f, i) => (
          <div key={f.name}>
            <label htmlFor={`p-${f.name}`} className="field-label">{f.label}</label>
            {f.multiline ? (
              <textarea id={`p-${f.name}`} className="input min-h-24 font-mono text-sm" value={values[f.name] ?? ''} placeholder={f.placeholder}
                autoFocus={i === 0} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
            ) : (
              <input id={`p-${f.name}`} className="input" value={values[f.name] ?? ''} placeholder={f.placeholder} autoFocus={i === 0}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
            )}
            {f.hint && <p className="field-hint">{f.hint}</p>}
          </div>
        ))}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {extraAction && <button type="button" className="btn btn-ghost mr-auto text-danger" onClick={() => { extraAction.onClick(); onClose(); }}>{extraAction.label}</button>}
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
