import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from 'lucide-react';
import { taxonomy, adminPosts, AppError, userMessage } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import type { Category } from '@/lib/types';
import { PageHeader } from '@/components/layout/AdminLayout';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export default function Categories() {
  const toast = useToast();
  const cats = useAsync(() => taxonomy.categories(), [], ['categories']);
  const tags = useAsync(() => taxonomy.tags(), [], ['tags']);
  const posts = useAsync(() => adminPosts.list({ pageSize: 10_000 }), [], ['posts']);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [del, setDel] = useState<{ kind: 'category' | 'tag'; id: string; name: string } | null>(null);

  const countFor = (catId: string) => posts.data?.items.filter((p) => p.categoryId === catId).length ?? 0;
  const tagCount = (tagId: string) => posts.data?.items.filter((p) => p.tagIds.includes(tagId)).length ?? 0;

  const reset = () => { setEditing(null); setName(''); setDescription(''); setError(''); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await taxonomy.saveCategory({ id: editing?.id, name, description });
      toast(editing ? 'Category updated' : 'Category added');
      reset();
    } catch (err) {
      setError(err instanceof AppError && err.fields?.name ? err.fields.name : userMessage(err));
    }
  };
  const move = async (i: number, dir: -1 | 1) => {
    const list = [...(cats.data ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await taxonomy.reorderCategories(list.map((c) => c.id));
  };

  return (
    <>
      <PageHeader title="Categories & tags" tour="categories" description="Categories are the main topics readers browse. Tags are finer labels added while writing." />
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="cats-h">
          <h2 id="cats-h" className="font-serif text-2xl font-medium">Categories</h2>
          <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-paper" data-tour="cat-list">
            {(cats.data ?? []).map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 p-3 sm:p-4">
                <div className="flex flex-col" {...(i === 0 ? { 'data-tour': 'cat-reorder' } : {})}>
                  <button data-tip="Move up in the topic order" className="inline-flex h-7 w-7 items-center justify-center rounded text-stone hover:bg-ink/5 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.name} up`}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button className="inline-flex h-7 w-7 items-center justify-center rounded text-stone hover:bg-ink/5 disabled:opacity-30" disabled={i === (cats.data?.length ?? 0) - 1} onClick={() => move(i, 1)} data-tip="Move down in the topic order" aria-label={`Move ${c.name} down`}><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{c.name} <span className="ml-1 text-xs font-normal text-stone">{countFor(c.id)} articles</span></p>
                  {c.description && <p className="truncate text-sm text-stone">{c.description}</p>}
                  <p className="text-xs text-stone">/blog/category/{c.slug}</p>
                </div>
                <button className="rounded p-2 text-stone hover:bg-ink/5 hover:text-ink" onClick={() => { setEditing(c); setName(c.name); setDescription(c.description); setError(''); }} data-tip="Rename or change the description" aria-label={`Edit ${c.name}`}><Pencil className="h-4 w-4" /></button>
                <button className="rounded p-2 text-stone hover:bg-danger/10 hover:text-danger" onClick={() => setDel({ kind: 'category', id: c.id, name: c.name })} data-tip="Delete the category. Its articles stay published." aria-label={`Delete ${c.name}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
            {cats.data?.length === 0 && <li className="p-6 text-center text-stone">No categories yet. Add the first one.</li>}
          </ul>

          <h2 className="mt-12 font-serif text-2xl font-medium">Tags</h2>
          {tags.data?.length ? (
            <ul className="mt-4 flex flex-wrap gap-2" data-tour="tag-list">
              {tags.data.map((t) => (
                <li key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper py-1 pl-3 pr-1 text-sm">
                  {t.name}<span className="text-xs text-stone">{tagCount(t.id)}</span>
                  <button className="rounded-full p-1 text-stone hover:bg-danger/10 hover:text-danger" onClick={() => setDel({ kind: 'tag', id: t.id, name: t.name })} data-tip="Remove this tag from every article" aria-label={`Delete tag ${t.name}`}><X className="h-3 w-3" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-stone">Tags appear here when you add them in the article editor.</p>}
        </section>

        <section aria-labelledby="form-h" data-tour="cat-form" className="h-fit rounded-md border border-line bg-paper p-5 lg:sticky lg:top-6">
          <h2 id="form-h" className="font-serif text-xl font-medium">{editing ? `Edit “${editing.name}”` : 'Add a category'}</h2>
          <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
            <div>
              <label htmlFor="cat-name" className="field-label">Name</label>
              <input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(error)} />
              {error && <p className="field-error">{error}</p>}
            </div>
            <div>
              <label htmlFor="cat-desc" className="field-label">Description</label>
              <textarea id="cat-desc" className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
              <p className="field-hint">Shown at the top of the category page.</p>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary">{editing ? 'Save changes' : 'Add category'}</button>
              {editing && <button type="button" className="btn btn-outline" onClick={reset}>Cancel</button>}
            </div>
          </form>
        </section>
      </div>

      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} danger
        title={`Delete “${del?.name}”?`}
        body={del?.kind === 'category' ? 'Articles in this category stay published and become uncategorised.' : 'The tag is removed from every article that uses it.'}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!del) return;
          try { if (del.kind === 'category') await taxonomy.deleteCategory(del.id); else await taxonomy.deleteTag(del.id); toast('Deleted'); }
          catch (e) { toast(userMessage(e), 'error'); }
          setDel(null);
          if (editing?.id === del.id) reset();
        }} />
    </>
  );
}
