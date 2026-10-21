import { useState, type ReactNode } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import 'katex/dist/katex.min.css';
import {
  Bold, Italic, Underline, Strikethrough, Link2, List, ListOrdered, Quote, Code2, Minus, ImagePlus, Table2, Sigma,
  Undo2, Redo2, Clapperboard, Megaphone, ArrowUp, ArrowDown, Trash2, Radical,
} from 'lucide-react';
import type { DocJSON, MediaAsset, CtaContent } from '@/lib/types';
import { articleExtensions, videoEmbedUrl, safeHref } from './extensions';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { PromptDialog, type PromptField } from '@/components/ui/PromptDialog';

interface Props {
  content: DocJSON;
  onChange: (doc: DocJSON) => void;
  onSaveShortcut?: () => void;
  ctaDefaults: CtaContent | null;
  dropCap: boolean;
}

type Prompt =
  | { kind: 'link' }
  | { kind: 'math'; display: boolean; pos?: number; latex?: string }
  | { kind: 'video' }
  | null;

function Btn({ label, onClick, active, disabled, children, tip, tour }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode; tip?: string; tour?: string }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} aria-label={label} data-tip={tip ?? label} data-tour={tour} aria-pressed={active}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded px-2 transition-colors disabled:opacity-35 ${active ? 'bg-obsidian text-ivory' : 'text-charcoal hover:bg-ink/[0.07]'}`}>
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-6 w-px bg-line" aria-hidden />;

/** Moves the top-level block containing the selection up or down. */
function moveBlock(editor: Editor, dir: -1 | 1) {
  const { state } = editor;
  const doc = state.doc;
  const index = state.selection.$from.index(0);
  const target = index + dir;
  if (target < 0 || target >= doc.childCount) return;
  const posOf = (i: number) => { let p = 0; for (let k = 0; k < i; k++) p += doc.child(k).nodeSize; return p; };
  const node = doc.child(index);
  const start = posOf(index);
  // After removing the block, the neighbour below slides up into `start`.
  const insertAt = dir === -1 ? posOf(target) : start + doc.child(index + 1).nodeSize;
  const tr = state.tr.delete(start, start + node.nodeSize).insert(insertAt, node);
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus(Math.min(insertAt + 1, editor.state.doc.content.size));
}

export function ArticleEditor({ content, onChange, onSaveShortcut, ctaDefaults, dropCap }: Props) {
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [picker, setPicker] = useState(false);

  const editor = useEditor({
    extensions: [
      ...articleExtensions().map((ext) => {
        if (ext.name === 'inlineMath' || ext.name === 'blockMath') {
          return ext.configure({
            katexOptions: { throwOnError: false },
            onClick: (node: { attrs: { latex: string } }, pos: number) => setPrompt({ kind: 'math', display: ext.name === 'blockMath', pos, latex: node.attrs.latex }),
          });
        }
        return ext;
      }),
      Placeholder.configure({ placeholder: 'Start writing. Use the toolbar or type ## for a heading.' }),
    ],
    content,
    editorProps: {
      attributes: { class: `prose-article ${dropCap ? '' : 'no-dropcap'}`, 'aria-label': 'Article body', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          onSaveShortcut?.();
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setPrompt({ kind: 'link' });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as DocJSON),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
  });

  // The parent remounts this component (via `key`) when content is replaced
  // from outside, e.g. restoring a revision, so `content` is only read once.

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : e.isActive('heading', { level: 4 }) ? 'h4' : e.isActive('codeBlock') ? 'code' : 'p',
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
      link: e.isActive('link'), bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'),
      image: e.isActive('image'), table: e.isActive('table'), cta: e.isActive('ctaBlock'), video: e.isActive('videoEmbed'),
      imageAttrs: e.isActive('image') ? e.getAttributes('image') : null,
      ctaAttrs: e.isActive('ctaBlock') ? e.getAttributes('ctaBlock') : null,
      canUndo: e.can().undo(), canRedo: e.can().redo(),
      linkHref: e.getAttributes('link').href as string | undefined,
    }),
  });
  if (!editor || !s) return null;
  const chain = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === 'p') chain().setParagraph().run();
    else if (v === 'code') chain().toggleCodeBlock().run();
    else chain().toggleHeading({ level: Number(v.slice(1)) as 2 | 3 | 4 }).run();
  };

  const insertImage = (a: MediaAsset) => {
    chain().setImage({ src: a.url, alt: a.alt }).updateAttributes('image', { mediaId: a.id, width: a.width, height: a.height, caption: a.caption }).run();
  };

  const promptConfig = (): { title: string; fields: PromptField[]; submit: string; onSubmit: (v: Record<string, string>) => void; validate?: (v: Record<string, string>) => string | null; extra?: { label: string; onClick: () => void } } | null => {
    if (!prompt) return null;
    if (prompt.kind === 'link') {
      return {
        title: s.link ? 'Edit link' : 'Add link',
        fields: [{ name: 'href', label: 'Web address', placeholder: 'https://', initial: s.linkHref ?? '', hint: 'Full web address, an email (mailto:…) or a page on this site starting with /.' }],
        submit: s.link ? 'Update link' : 'Add link',
        validate: (v) => (safeHref(v.href.includes('://') || v.href.startsWith('/') || v.href.startsWith('mailto:') ? v.href : `https://${v.href}`) ? null : 'Enter a valid web address.'),
        onSubmit: (v) => {
          const href = v.href.includes('://') || v.href.startsWith('/') || v.href.startsWith('mailto:') ? v.href : `https://${v.href}`;
          if (editor.state.selection.empty && !s.link) chain().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
          else chain().extendMarkRange('link').setLink({ href }).run();
        },
        extra: s.link ? { label: 'Remove link', onClick: () => chain().extendMarkRange('link').unsetLink().run() } : undefined,
      };
    }
    if (prompt.kind === 'math') {
      return {
        title: prompt.display ? 'Equation (own line)' : 'Inline equation',
        fields: [{ name: 'latex', label: 'LaTeX', multiline: true, initial: prompt.latex ?? '', placeholder: prompt.display ? '\\int_0^1 x^2\\,dx = \\tfrac{1}{3}' : 'a^2 + b^2 = c^2', hint: 'Written in LaTeX, rendered with KaTeX.' }],
        submit: prompt.pos !== undefined ? 'Update' : 'Insert',
        validate: (v) => (v.latex.trim() ? null : 'Enter an equation.'),
        onSubmit: ({ latex }) => {
          if (prompt.pos !== undefined) {
            editor.chain().setNodeSelection(prompt.pos).updateAttributes(prompt.display ? 'blockMath' : 'inlineMath', { latex }).focus().run();
          } else if (prompt.display) chain().insertBlockMath({ latex }).run();
          else chain().insertInlineMath({ latex }).run();
        },
        extra: prompt.pos !== undefined ? { label: 'Remove', onClick: () => editor.chain().setNodeSelection(prompt.pos!).deleteSelection().focus().run() } : undefined,
      };
    }
    return {
      title: 'Embed a video',
      fields: [{ name: 'url', label: 'YouTube or Vimeo link', placeholder: 'https://www.youtube.com/watch?v=…' }, { name: 'title', label: 'Video title', hint: 'Read out by screen readers.' }],
      submit: 'Embed video',
      validate: (v) => (videoEmbedUrl(v.url) ? null : 'Paste a YouTube or Vimeo link. Other sites can’t be embedded.'),
      onSubmit: (v) => chain().insertContent({ type: 'videoEmbed', attrs: { src: videoEmbedUrl(v.url), title: v.title || 'Embedded video' } }).run(),
    };
  };
  const pc = promptConfig();

  return (
    <div className="editor-surface">
      <div role="toolbar" aria-label="Formatting" data-tour="toolbar" className="sticky top-[3.75rem] z-20 -mx-1 flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-paper/95 p-1 shadow-sm backdrop-blur">
        <label htmlFor="block-type" className="sr-only">Text style</label>
        <select id="block-type" data-tour="block-type" data-tip="Turn the current line into a heading, subheading or code" value={s.block} onChange={(e) => setBlock(e.target.value)} className="h-9 rounded border-0 bg-transparent pl-2 pr-7 text-sm font-medium hover:bg-ink/[0.07] focus:ring-2 focus:ring-accent/30">
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="h4">Small heading</option>
          <option value="code">Code block</option>
        </select>
        <Sep />
        <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
        <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
        <Btn label="Underline (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}><Underline className="h-4 w-4" /></Btn>
        <Btn label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
        <Btn label="Link (Ctrl+K)" tip="Link the selected text to a web page (Ctrl+K)" active={s.link} onClick={() => setPrompt({ kind: 'link' })}><Link2 className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn label="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn label="Quote" tip="Set the paragraph apart as a quotation" active={s.quote} onClick={() => chain().toggleBlockquote().run()}><Quote className="h-4 w-4" /></Btn>
        <Btn label="Divider" tip="Add a decorative break between sections" onClick={() => chain().setHorizontalRule().run()}><Minus className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Image" tour="insert-image" tip="Insert an image from your library or upload one" onClick={() => setPicker(true)}><ImagePlus className="h-4 w-4" /></Btn>
        <Btn label="Table" tip="Insert a 3 × 3 table. Add rows and columns once it’s in." active={s.table} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="h-4 w-4" /></Btn>
        <Btn label="Inline equation" tip="An equation inside a sentence, written in LaTeX" onClick={() => setPrompt({ kind: 'math', display: false })}><Radical className="h-4 w-4" /></Btn>
        <Btn label="Equation on its own line" tour="insert-math" tip="A centred equation on its own line, written in LaTeX" onClick={() => setPrompt({ kind: 'math', display: true })}><Sigma className="h-4 w-4" /></Btn>
        <Btn label="Video" tip="Embed a YouTube or Vimeo video" onClick={() => setPrompt({ kind: 'video' })}><Clapperboard className="h-4 w-4" /></Btn>
        <Btn label="Call-to-action box" tour="insert-cta" tip="A highlighted box with a button, e.g. inviting readers to the academy" onClick={() => chain().insertContent({ type: 'ctaBlock', attrs: ctaDefaults ?? { title: 'Learn with us', text: '', label: 'Learn more', href: '/' } }).run()}><Megaphone className="h-4 w-4" /></Btn>
        <Btn label="Inline code" tip="Format selected text as code" onClick={() => chain().toggleCode().run()}><Code2 className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Move block up" tour="move-block" tip="Move the paragraph or image your cursor is in up" onClick={() => moveBlock(editor, -1)}><ArrowUp className="h-4 w-4" /></Btn>
        <Btn label="Move block down" tip="Move the paragraph or image your cursor is in down" onClick={() => moveBlock(editor, 1)}><ArrowDown className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => chain().undo().run()}><Undo2 className="h-4 w-4" /></Btn>
        <Btn label="Redo (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={() => chain().redo().run()}><Redo2 className="h-4 w-4" /></Btn>
      </div>

      {/* Context panels for the selected block */}
      {s.image && s.imageAttrs && (
        <div className="mt-2 grid gap-3 rounded-md border border-line bg-paper p-3 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className="field-label text-xs" htmlFor="img-alt">Alt text</label>
            <input id="img-alt" className="input" value={String(s.imageAttrs.alt ?? '')} onChange={(e) => editor.commands.updateAttributes('image', { alt: e.target.value })} placeholder="Describe the image" />
          </div>
          <div>
            <label className="field-label text-xs" htmlFor="img-cap">Caption</label>
            <input id="img-cap" className="input" value={String(s.imageAttrs.caption ?? '')} onChange={(e) => editor.commands.updateAttributes('image', { caption: e.target.value })} placeholder="Shown under the image" />
          </div>
          <button type="button" className="btn btn-outline text-danger" onClick={() => chain().deleteSelection().run()}><Trash2 className="h-4 w-4" />Remove</button>
        </div>
      )}
      {s.cta && s.ctaAttrs && (
        <div className="mt-2 grid gap-3 rounded-md border border-line bg-paper p-3 text-sm sm:grid-cols-2">
          {(['title', 'text', 'label', 'href'] as const).map((k) => (
            <div key={k}>
              <label className="field-label text-xs" htmlFor={`cta-${k}`}>{{ title: 'Heading', text: 'Text', label: 'Button text', href: 'Button link' }[k]}</label>
              <input id={`cta-${k}`} className="input" value={String(s.ctaAttrs![k] ?? '')} onChange={(e) => editor.commands.updateAttributes('ctaBlock', { [k]: e.target.value })} />
            </div>
          ))}
          <button type="button" className="btn btn-outline justify-self-start text-danger" onClick={() => chain().deleteSelection().run()}><Trash2 className="h-4 w-4" />Remove box</button>
        </div>
      )}
      {s.table && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-md border border-line bg-paper p-2 text-xs">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => chain().addRowAfter().run()}>Add row</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => chain().addColumnAfter().run()}>Add column</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => chain().deleteRow().run()}>Delete row</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => chain().deleteColumn().run()}>Delete column</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => chain().toggleHeaderRow().run()}>Toggle header row</button>
          <button type="button" className="btn btn-outline btn-sm text-danger" onClick={() => chain().deleteTable().run()}>Delete table</button>
        </div>
      )}
      {s.video && (
        <div className="mt-2 flex rounded-md border border-line bg-paper p-2">
          <button type="button" className="btn btn-outline btn-sm text-danger" onClick={() => chain().deleteSelection().run()}><Trash2 className="h-4 w-4" />Remove video</button>
        </div>
      )}

      <EditorContent editor={editor} className="mt-8" />

      <MediaPicker open={picker} onClose={() => setPicker(false)} onPick={insertImage} title="Insert an image" />
      {pc && (
        <PromptDialog open={Boolean(prompt)} title={pc.title} fields={pc.fields} submitLabel={pc.submit} onClose={() => setPrompt(null)}
          onSubmit={pc.onSubmit} validate={pc.validate} extraAction={pc.extra} />
      )}
    </div>
  );
}
