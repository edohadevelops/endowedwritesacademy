# Endowed Academy: Blog and Publishing Platform (Phase 1)

The public blog and private writing desk for Endowed Academy. Readers browse,
search and comment on articles. The owner writes, schedules and manages
everything from `/admin` without touching code.

The app runs in two modes from the same code:

- **Preview mode** (no environment variables): everything is saved in the
  browser (IndexedDB). Good for trying things out, but **articles are only
  visible in that one browser**, so don't share links from it.
- **Live mode** (`VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` set):
  articles, images, comments and settings live in Supabase and everyone sees
  them. **[MIGRATION.md](MIGRATION.md)** walks through GitHub, Supabase and
  Netlify step by step.

Content written in preview mode moves across with **Import articles → Export
all articles** and then importing that file on the live site.

---

## What's included

**Public site**
- Blog home: editorial hero, a featured article chosen by the owner, latest articles, topic filters, search and pagination
- Article pages: reading-progress bar, automatic table of contents, KaTeX maths, tables, images with captions, YouTube/Vimeo embeds, call-to-action boxes, share and copy-link buttons, related articles, comments
- Category and tag pages, a 404 page, and "coming soon" pages for About, Courses and Contact
- SEO: titles, descriptions, canonical URLs, Open Graph and Twitter tags, Article JSON-LD, a sitemap and robots.txt (via Netlify edge functions once Supabase is connected), and redirects from old slugs

**Admin (`/admin`)**
- Sign-in, sign-out and password change. Preview mode has a first-run owner setup; live mode uses an invitation from Supabase (no public sign-up in either)
- Dashboard with real counts, recent edits, scheduled posts and an activity log
- Articles: search, sort, status tabs (drafts, scheduled, published, archived, trash), bulk publish, unpublish, archive and trash; duplicate; feature on the home page; restore from trash; permanent delete only from trash
- Editor (TipTap): headings, bold/italic/underline/strike, links, lists, quotes, dividers, code, images with alt text and captions, tables, inline and display equations, video embeds, CTA boxes, moving blocks up and down, undo/redo, keyboard shortcuts (Ctrl+S, Ctrl+K)
- Autosave with clear states (saving, saved, unsaved, failed, conflict). Saves are conflict-aware, a backup is kept in the browser, there's a warning before leaving with unsaved work, and live articles only change when you press **Update**
- Revision history (last 30 per article) with preview and restore
- Private preview, scheduling in local time (stored in UTC), SEO fields with a search-result preview, per-article comment toggle
- Media library: upload with type, content and size checks; images are re-encoded to WebP (which strips metadata); alt text; captions; file replacement; usage tracking; deletion is blocked while an image is in use
- Comment moderation: waiting, approved, spam and rejected tabs, filter by article, bulk actions, and automatic flags shown to the moderator
- Settings: name, tagline, logo, accent colour (with a contrast check and live preview), body type style, drop cap, hero copy, call to action, menus, social links, footer, contact email, comment rules and blocked words, SEO defaults
- **Import articles** (bulk): Word (.docx), Markdown with front matter (equations included), HTML, a CSV spreadsheet (template provided), Blogger backups and import bundles. Images are matched by file name and added to Media. Review titles, status and category before importing; existing web addresses are skipped
- **Export all articles**: one file with every article, its images and approved comments, for backup or for moving from preview to live
- **Onboarding**: every admin page has a short guided tour that appears the first time and stays away once finished or skipped. A **?** button replays it. Every action has a hover/focus tip explaining what it does. Tips can be switched off and tours reset in Settings → Account
- **Password reset by email** (live mode)

---

## Tech stack and key decisions

| Area | Choice | Why |
|---|---|---|
| Framework | Vite + React 19 + React Router 7, TypeScript | Follows the structure of the supplied template (Vite/React/Tailwind/Router, `components/layout`, `components/ui`, `pages/public`, `pages/admin`, `context`) rather than migrating to Next.js |
| SEO for a single-page app | Netlify Edge Function injects article meta into the HTML | Gives WhatsApp, X and Facebook link previews without a server-rendering rewrite |
| Styling | Tailwind 3 mapped onto CSS-variable design tokens | Lets the owner's brand settings recolour the site at runtime |
| Editor | TipTap 3 | Stable, accessible, extensible; maths via the official KaTeX extension |
| Content storage | TipTap JSON plus sanitised HTML rendered at save time | Readers get ready-made HTML (sanitised again with DOMPurify on display), so the editor never ships to them |
| Data access | One API module (`src/lib/data`) with two adapters, `local.ts` and `supabase.ts`, chosen at build time | Pages never touch storage directly; only one adapter is bundled; a type check fails if the two adapters' functions differ |
| Comments | Shared validation module used by both the browser and the Supabase Edge Function | One set of rules; a unit test fails if the copies drift |
| Fonts | Newsreader (headlines and article text), Hanken Grotesk (interface), self-hosted | No third-party font requests; fallback metrics are tuned so text doesn't jump when fonts load |

**Brand colour:** the brief's `#C65A24` gives 4.3:1 contrast with white
button text, just under WCAG AA's 4.5:1. The default is `#BF5520`, which is
visually almost identical and passes at 4.6:1. The owner can change it in
Settings, which refuses colours that would make button text unreadable.

---

## Project structure

```
src/
  App.tsx                 routes (admin is lazy-loaded, so readers never download it)
  config/defaults.ts      default settings, categories, limits
  context/                SiteContext (settings + brand), AuthContext
  lib/
    types.ts              domain types (mirror the SQL schema)
    data/                 data API: index.ts (entry), backend.ts (switch),
                          local.ts (preview adapter) + store.ts (IndexedDB),
                          supabase.ts (live adapter), shared.ts, media.ts (upload checks)
    utils/                slugs, text, dates, colour contrast
  features/
    editor/               TipTap schema (shared) + editor component
    content/render.ts     JSON → sanitised HTML, heading ids, KaTeX
    comments/moderation.ts validation + abuse checks (shared with the Edge Function)
    import/               file parsers (Word, Markdown, CSV, HTML, Blogger, bundles), import runner, export
    onboarding/           page tours, hover tips, tour definitions
    seo/useHead.ts        client-side meta tags
    auth/crypto.ts        local-only password hashing (PBKDF2)
  components/             layout, ui, blog, admin
  pages/public, pages/admin
supabase/
  config.toml             sign-ups off, comment function settings
  migrations/             schema, triggers, RLS, grants, storage policies (4 files)
  functions/submit-comment  public comment endpoint (Deno)
netlify/edge-functions/   article-meta, sitemap, robots
scripts/                  make-import-bundle.mjs, sync-shared.mjs
public/                   import-template.csv, import-example.md
tests/
  unit/                   Vitest
  e2e/                    Playwright (preview mode + supabase.spec.ts for live mode)
  db/                     RLS security tests against PostgreSQL
  supabase-local/         local Supabase stand-in used by the live-mode tests
.github/workflows/ci.yml  type check, build, unit, database and end-to-end tests on every push
```

---

## Running locally

Requires Node 22.

```bash
npm install
npm run dev            # http://localhost:5173
```

Open `/admin`. In preview mode the first visit asks you to create the owner
account. To run against Supabase locally, add the two `VITE_` variables to
`.env.local` (see `.env.example`).

| Script | What it does |
|---|---|
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright; starts the dev server) |
| `npm run test:db` | Applies the migrations to a scratch PostgreSQL database and runs the RLS tests (needs `PGHOST`/`PGPORT`/`PGUSER`) |
| `npm run test:supabase` | Live-mode end-to-end tests against the local Supabase stand-in (see `tests/supabase-local/README.md`) |
| `npm run sync:shared` | Copies the comment rules into the Edge Function after you edit them |
| `npm run bundle -- <folder> [out.json]` | Packs a folder of old articles and images into one file for **Import articles** |

### Bulk importing someone's old articles

Put everything in one folder (Word files, Markdown, HTML, a CSV, a Blogger
backup, plus any images they use) and either upload the files on
**Import articles**, choose the whole folder there, or run
`npm run bundle -- ./old-posts posts.json` and upload `posts.json`. Nothing
is published unless the file says so, or you choose "All published".

---

## Test results (run on 20 Oct 2026)

| Suite | Result |
|---|---|
| Unit (Vitest) | **61 passed**: comment validation and abuse checks; slugs, reading time and the table of contents; rendering and sanitisation; embeds, link safety and contrast; Blogger, Markdown (front matter and equations), CSV, HTML and bundle parsing; data API tests for auth, lockout, authorisation, draft privacy, scheduling, conflicts, slug redirects, revisions, trash and comments |
| End-to-end, preview mode (Playwright) | **12 passed**: the full admin workflow; the reader workflow; security; Blogger import; scheduling, brand settings and featuring; no horizontal overflow from 320 to 1440px; axe scan with no serious WCAG 2.2 AA issues on 12 pages; page tours (auto-show, dismiss, replay, every page, phone layout, tips on and off); bulk import of Word, Markdown with images, CSV and a bundle; missing-image and unsupported-file warnings; **export, then re-import into a fresh site** |
| End-to-end, live mode (real Supabase Auth + PostgREST + migrations + Edge Function) | **9 passed**. See [MIGRATION.md](MIGRATION.md#how-this-was-tested-before-handover) |
| Netlify edge functions | **4 passed**: link-preview tags, no draft leaks, sitemap, robots.txt |
| Database security (PostgreSQL 16) | **38 passed**: visitors, signed-in non-admins and admins each get exactly the access they should |
| Lighthouse (production build, mobile) | Performance 90, Accessibility 100, Best Practices 100, SEO 100. CLS 0.018 |

`npm audit --omit=dev` reports **0 vulnerabilities**. The remaining advisories
are in Tailwind 3's build tooling, which never ships to the browser.

---

## Going live

See **[MIGRATION.md](MIGRATION.md)**. It covers GitHub, creating the Supabase
project, migrations, sign-in settings, inviting the owner, deploying the
comment function, Netlify settings and variables, the custom domain, moving
content across, a launch checklist, day-to-day changes and troubleshooting.

---

## Security model

- **Authorisation** comes from the `admin_roles` table, checked by `is_admin()` inside RLS policies. It never comes from client data or email comparisons. No client can insert into `admin_roles`.
- **RLS is enabled on every table**, and grants follow least privilege. The public can read only published articles that are live now, approved comments (without moderation fields), categories, tags and public settings.
- **Drafts** are never public. They stay out of search, the sitemap, previews (admin-only route plus an admin-only query) and edge metadata.
- **XSS**: article HTML is generated from a strict schema, then sanitised with DOMPurify. Links are limited to http, https, mailto and tel. Embeds are limited to YouTube (privacy-enhanced mode) and Vimeo. Comments are plain text only.
- **Uploads**: images only, checked by file signature (not by extension), 8 MB limit, re-encoded (no SVG), stored at random paths, written by admins only.
- **Comments** can only be created by the `submit-comment` Edge Function (validation, published-article check, rate limit by salted IP hash kept for 24 hours, spam and blocked-word checks). Only an admin can insert comments directly, for imports.
- **Preview mode only**: the in-browser admin password is hashed with PBKDF2 (310,000 rounds), but browser storage can't truly protect anything. Live mode uses Supabase Auth.

---

## Known limitations and next steps

1. **Hosted services not yet exercised**: live mode was tested against real Supabase Auth and PostgREST, but with a stand-in for Storage and without real email or Netlify's runtime. The launch checklist in MIGRATION.md covers these.
2. **First paint**: as a single-page app, the first visit renders after the JavaScript loads (about 2.9 s on Lighthouse's throttled mobile profile). Server rendering, or prerendering the blog home, would improve this if needed later.
3. **Responsive images**: once on Supabase, use Storage image transformations to serve sized `srcset` variants. Uploads are already capped at 2400 px and converted to WebP.
4. **Remote images** in imported articles (for example, Blogger-hosted ones) stay where they are. Local image files and images inside Word documents are copied into Media.
5. **Tour progress** is remembered per browser. With Supabase it could move to the admin's profile to follow them across devices.
6. **Analytics**: not included. No view counts are shown rather than inventing them.
7. **Academy pages** (About, Courses, Contact) are "coming soon" placeholders, reachable from the menu, until their content exists.
8. **Comment moderation** uses pattern rules, not an AI classifier. Anything uncertain goes to the moderator.
