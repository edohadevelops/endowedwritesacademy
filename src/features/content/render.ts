import { generateHTML } from '@tiptap/html';
import DOMPurify from 'dompurify';
import katex from 'katex';
import type { DocJSON } from '@/lib/types';
import { articleExtensions } from '@/features/editor/extensions';
import { headingId } from '@/lib/utils/content';

const ALLOWED_IFRAME = /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/;

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'iframe') {
      const src = (node as Element).getAttribute('src') ?? '';
      if (!ALLOWED_IFRAME.test(src)) node.parentNode?.removeChild(node);
    }
  });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
      const href = node.getAttribute('href') ?? '';
      if (!href.startsWith(window.location.origin)) {
        node.setAttribute('rel', 'noopener noreferrer nofollow');
        node.setAttribute('target', '_blank');
      }
    }
  });
}

/**
 * Turns stored article JSON into safe HTML. Content is generated from a
 * strict schema and then sanitised again, so even a tampered database row
 * can't inject scripts into the page.
 */
export function renderArticleHtml(doc: DocJSON): string {
  ensureHooks();
  let html: string;
  try {
    html = generateHTML(doc as Parameters<typeof generateHTML>[0], articleExtensions());
  } catch {
    return '<p>This article could not be displayed.</p>';
  }
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'referrerpolicy', 'data-latex', 'data-type', 'data-media-id', 'target'],
    FORBID_ATTR: ['style'],
  });

  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  const root = tpl.content;

  const seen = new Map<string, number>();
  root.querySelectorAll('h2, h3').forEach((h) => {
    h.id = headingId(h.textContent ?? '', seen);
  });
  root.querySelectorAll('table').forEach((t) => {
    if (t.parentElement?.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Table');
    t.replaceWith(wrap);
    wrap.appendChild(t);
  });
  root.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? '';
    try {
      el.innerHTML = katex.renderToString(latex, {
        displayMode: el.dataset.type === 'block-math',
        throwOnError: false,
        trust: false,
        output: 'htmlAndMathml',
      });
    } catch {
      el.textContent = latex;
    }
  });
  const div = document.createElement('div');
  div.appendChild(root.cloneNode(true));
  return div.innerHTML;
}
