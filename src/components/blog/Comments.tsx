import { useRef, useState, type FormEvent } from 'react';
import { publicApi, AppError, userMessage } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { LIMITS } from '@/features/comments/moderation';
import { timeAgo, formatDateTime } from '@/lib/utils/format';
import { Initials } from './ArticleParts';

export function Comments({ postId, open }: { postId: string; open: boolean }) {
  const { data: comments, loading } = useAsync(() => publicApi.approvedComments(postId), [postId], ['comments']);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'pending' | 'approved'>('idle');
  const [formError, setFormError] = useState('');
  const startedAt = useRef(Date.now());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setState('sending');
    try {
      const res = await publicApi.submitComment(postId, { name, body, website, elapsedMs: Date.now() - startedAt.current });
      setState(res.status);
      setBody('');
    } catch (err) {
      setState('idle');
      if (err instanceof AppError && err.fields) setErrors(err.fields);
      else setFormError(userMessage(err, 'Your comment couldn’t be sent. Check your connection and try again.'));
    }
  };

  const count = comments?.length ?? 0;
  return (
    <section aria-labelledby="comments-title" className="mt-16 border-t border-line pt-12">
      <h2 id="comments-title" className="font-serif text-3xl font-medium">
        {count > 0 ? `${count} ${count === 1 ? 'comment' : 'comments'}` : 'Comments'}
      </h2>

      {loading ? (
        <div className="mt-6 space-y-3" aria-hidden><div className="skeleton h-4 w-1/3" /><div className="skeleton h-4 w-2/3" /></div>
      ) : count > 0 ? (
        <ol className="mt-8 space-y-8">
          {comments!.map((c) => (
            <li key={c.id} className="flex gap-4">
              <Initials name={c.authorName} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-semibold text-ink">{c.authorName}</span>
                  <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)} className="text-stone">{timeAgo(c.createdAt)}</time>
                </p>
                {/* Plain text only: React escapes it, and line breaks are kept with CSS. */}
                <p className="mt-1.5 whitespace-pre-line break-words text-[1rem] leading-relaxed text-ink">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-stone">{open ? 'No comments yet. Start the conversation.' : 'No comments.'}</p>
      )}

      {!open ? (
        <p className="mt-8 rounded-md border border-line bg-paper px-5 py-4 text-sm text-stone">Comments are closed for this article.</p>
      ) : state === 'pending' || state === 'approved' ? (
        <div className="mt-10 rounded-md border border-line bg-paper px-5 py-5" role="status">
          <p className="font-serif text-xl">{state === 'approved' ? 'Your comment is posted.' : 'Thanks, your comment is awaiting approval.'}</p>
          <p className="mt-1 text-sm text-stone">
            {state === 'approved' ? 'It now appears above.' : 'Every comment is read by the academy before it appears here.'}
          </p>
          <button className="btn btn-outline btn-sm mt-4" onClick={() => { setState('idle'); startedAt.current = Date.now(); }}>Write another comment</button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-10 rounded-md border border-line bg-paper p-5 sm:p-6">
          <h3 className="font-serif text-xl font-medium">Leave a comment</h3>
          <p className="mt-1 text-sm text-stone">Your name is shown with your comment. No email or account needed. Comments appear after approval.</p>
          <div className="mt-5 grid gap-4">
            <div className="max-w-sm">
              <label htmlFor="c-name" className="field-label">Name</label>
              <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.nameMax}
                autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'c-name-err' : undefined} required />
              {errors.name && <p id="c-name-err" className="field-error">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="c-body" className="field-label">Comment</label>
              <textarea id="c-body" className="input min-h-32 resize-y py-2.5" value={body} onChange={(e) => setBody(e.target.value)} maxLength={LIMITS.bodyMax}
                aria-invalid={Boolean(errors.body)} aria-describedby={`c-body-count${errors.body ? ' c-body-err' : ''}`} required />
              <div className="mt-1 flex justify-between gap-4">
                {errors.body ? <p id="c-body-err" className="field-error mt-0">{errors.body}</p> : <span />}
                <p id="c-body-count" className="text-xs text-stone">{body.length} / {LIMITS.bodyMax}</p>
              </div>
            </div>
            {/* Honeypot: hidden from people and assistive tech, bots fill it in. */}
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
              <label htmlFor="c-website">Website</label>
              <input id="c-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </div>
          {formError && <p className="field-error mt-4" role="alert">{formError}</p>}
          <button type="submit" className="btn btn-primary mt-5" disabled={state === 'sending'}>
            {state === 'sending' ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      )}
    </section>
  );
}
