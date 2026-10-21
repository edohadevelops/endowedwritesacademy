// The article schema. Shared by the editor, the public renderer, previews
// and the Blogger importer, so all four agree on what an article can contain.

import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import { Node, mergeAttributes, type AnyExtension } from '@tiptap/core';

// ---- image with caption, alt and media-library id -------------------------
export const Figure = Image.extend({
  name: 'image',
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: { default: null, parseHTML: (el) => el.getAttribute('data-media-id'), renderHTML: (a) => (a.mediaId ? { 'data-media-id': a.mediaId } : {}) },
      caption: { default: '', parseHTML: () => '', renderHTML: () => ({}) },
      width: { default: null },
      height: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure',
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector('img');
          if (!img?.getAttribute('src')) return false;
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') ?? '',
            mediaId: img.getAttribute('data-media-id'),
            caption: (el as HTMLElement).querySelector('figcaption')?.textContent?.trim() ?? '',
            width: Number(img.getAttribute('width')) || null,
            height: Number(img.getAttribute('height')) || null,
          };
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (el) => ({
          width: Number((el as HTMLElement).getAttribute('width')) || null,
          height: Number((el as HTMLElement).getAttribute('height')) || null,
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { caption, ...imgAttrs } = HTMLAttributes;
    const img = ['img', mergeAttributes(imgAttrs, { loading: 'lazy', decoding: 'async', alt: node.attrs.alt ?? '' })];
    return node.attrs.caption ? ['figure', {}, img, ['figcaption', {}, node.attrs.caption]] : ['figure', {}, img];
  },
}).configure({ inline: false, allowBase64: false });

// ---- call-to-action block --------------------------------------------------
export const CtaBlock = Node.create({
  name: 'ctaBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { title: { default: '' }, text: { default: '' }, label: { default: '' }, href: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'aside.cta-block',
      getAttrs: (el) => {
        const e = el as HTMLElement;
        return {
          title: e.querySelector('h4')?.textContent ?? '',
          text: e.querySelector('p')?.textContent ?? '',
          label: e.querySelector('a')?.textContent ?? '',
          href: e.querySelector('a')?.getAttribute('href') ?? '',
        };
      },
    }];
  },
  renderHTML({ node }) {
    const { title, text, label, href } = node.attrs as Record<string, string>;
    const safe = safeHref(href) ?? '#';
    return ['aside', { class: 'cta-block' }, ['h4', {}, title], ['p', {}, text], ['a', { href: safe }, label || 'Learn more']];
  },
});

// ---- video embeds (YouTube / Vimeo only) -----------------------------------
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ?? null;
    }
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const vid = u.pathname.match(/(\d{6,12})/)?.[1];
      if (vid) return `https://player.vimeo.com/video/${vid}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '' }, title: { default: 'Embedded video' } };
  },
  parseHTML() {
    return [{
      tag: 'div.video-embed',
      getAttrs: (el) => {
        const src = videoEmbedUrl((el as HTMLElement).querySelector('iframe')?.getAttribute('src') ?? '');
        return src ? { src, title: (el as HTMLElement).querySelector('iframe')?.getAttribute('title') ?? 'Embedded video' } : false;
      },
    }, {
      tag: 'iframe[src]',
      getAttrs: (el) => {
        const src = videoEmbedUrl((el as HTMLElement).getAttribute('src') ?? '');
        return src ? { src } : false;
      },
    }];
  },
  renderHTML({ node }) {
    const src = videoEmbedUrl(String(node.attrs.src)) ?? '';
    return ['div', { class: 'video-embed' }, ['iframe', {
      src, title: node.attrs.title || 'Embedded video', loading: 'lazy',
      allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: 'true',
    }]];
  },
});

export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (h.startsWith('#')) return h;
  try {
    const u = new URL(h);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

// Built once: the link extension registers URL schemes globally on creation.
let cached: AnyExtension[] | null = null;
export function articleExtensions(): AnyExtension[] {
  return (cached ??= [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto', 'tel'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
    }),
    Figure,
    TableKit.configure({ table: { resizable: false } }),
    InlineMath,
    BlockMath,
    CtaBlock,
    VideoEmbed,
  ]);
}
