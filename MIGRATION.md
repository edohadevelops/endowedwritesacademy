# Going live: GitHub → Supabase → Netlify

This guide takes the site from the **browser preview** (everything saved in
one browser) to the **live site** (articles stored in Supabase, the site
served by Netlify, code kept on GitHub). Follow the steps in order. Budget
about an hour the first time.

Nothing in the app's pages changes. The switch happens at build time: when
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set, the build
uses the Supabase adapter (`src/lib/data/supabase.ts`) instead of the
browser one (`src/lib/data/local.ts`). Both expose the same functions, and a
type check fails if they ever drift apart.

---

## What you end up with

```
Reader / admin browser
   │
   ├──►  Netlify  ─────────────  the site (static files from `npm run build`)
   │       ├─ edge function  article-meta   (title + preview tags for /blog/<slug>)
   │       ├─ edge function  sitemap        (/sitemap.xml, published articles only)
   │       └─ edge function  robots         (/robots.txt)
   │
   └──►  Supabase
           ├─ Postgres     articles, comments, categories, settings (+ Row Level Security)
           ├─ Auth         the owner's login, password reset emails
           ├─ Storage      bucket "media" for images
           └─ Edge Function  submit-comment  (the only way visitors can write anything)
```

| Piece | Where it lives in this repo | What it does |
|---|---|---|
| Database schema, security rules, storage bucket | `supabase/migrations/*.sql` (4 files) | Tables, triggers, RLS policies, grants, bucket and storage policies |
| Supabase settings | `supabase/config.toml` | Sign-ups off; `submit-comment` accepts visitors who aren't signed in |
| Comment endpoint | `supabase/functions/submit-comment/` + `_shared/moderation.ts` | Validates, rate-limits, spam-checks and stores comments |
| Netlify build, redirects, headers | `netlify.toml` | Build command, SPA fallback, security headers, caching |
| Netlify edge functions | `netlify/edge-functions/*.ts` | Link previews, sitemap, robots.txt |
| Supabase data adapter | `src/lib/data/supabase.ts` | How the app talks to Supabase |

---

## Step 0. Before you start

You need:

- Accounts on **GitHub**, **Supabase** and **Netlify** (free tiers are fine to start).
- **Node 22** and **Git** on your computer.
- The **Supabase CLI**: `npm install -g supabase`, or `brew install supabase/tap/supabase` on a Mac. Check with `supabase --version`.
- A password manager for the database password and keys.

**If articles were written in the browser preview:** open the preview, go to
**Import articles → Export all articles**, and keep the downloaded `.json`
file. You'll import it into the live site in step 9. Content in the preview
does not move by itself.

---

## Step 1. Put the code on GitHub

The project is already a Git repository with one commit.

1. On GitHub, click **New repository**. Name it, for example `endowed-academy`, and make it **Private**. Do **not** add a README, .gitignore or licence (the project has them).
2. In the project folder:
   ```bash
   git remote add origin https://github.com/<your-account>/endowed-academy.git
   git push -u origin main
   ```
3. Check that `.env.local` is **not** on GitHub. `.gitignore` already excludes it. Keys never go in the repository.

`.github/workflows/ci.yml` runs the type check, build, unit tests,
database security tests and end-to-end tests on every push. Check the
**Actions** tab after your first push. Netlify deploys separately (step 7).

---

## Step 2. Create the Supabase project

1. supabase.com → **New project**.
2. **Name**: `endowed-academy`. **Region**: the closest to most readers (for Nigeria and Europe, choose an EU region; for the US, choose an East US region).
3. **Database password**: generate a strong one and save it in your password manager. The CLI asks for it.
4. When the project is ready, open **Project Settings → API Keys** and note:
   - **Project URL**, e.g. `https://abcdefgh.supabase.co`
   - **Publishable key** (`sb_publishable_…`). On older projects use the legacy **anon** key. Either works.
   - The **project ref**: the `abcdefgh` part of the URL.

Never copy the **secret** (`sb_secret_…`) or legacy **service_role** key
into the app, Netlify or GitHub. Only Supabase's own Edge Functions get it,
automatically.

---

## Step 3. Create the database

```bash
supabase login
supabase link --project-ref <project-ref>        # asks for the database password
supabase db push                                  # applies supabase/migrations in order
```

`db push` lists four migrations and asks to confirm:

| File | Creates |
|---|---|
| `…0100_initial_schema.sql` | Tables: admin roles, posts, revisions, categories, tags, comments, media, settings, audit log, rate-limit records. Full-text search index |
| `…0200_functions_triggers.sql` | Version bump on save (autosave conflict check), old-slug redirects, one featured article, revision limit (30), search and slug functions |
| `…0300_rls_and_grants.sql` | Row Level Security on every table, least-privilege grants, the `media` storage bucket (8 MB limit, images only) and its policies |
| `…0400_import_and_defaults.sql` | Lets admins import comments; records who created rows |

**Check it worked:** Table Editor shows the tables, and Storage shows a
`media` bucket marked Public.

*No CLI?* Open **SQL Editor** and run the four files in order, pasting each
one in full.

---

## Step 4. Set up sign-in

In the Supabase dashboard:

1. **Authentication → Sign In / Providers**: under **Email**, turn **off "Allow new users to sign up"**. Only invited people can have accounts. The app has no sign-up page either.
2. Same page: set **Minimum password length** to **12**, matching the app's rule.
3. **Authentication → URL Configuration**:
   - **Site URL**: your live address, e.g. `https://www.endowedacademy.com`. Use the Netlify address (`https://<name>.netlify.app`) until the domain is connected.
   - **Redirect URLs**: add
     `https://www.endowedacademy.com/admin/reset-password`,
     `https://<name>.netlify.app/admin/reset-password` and
     `http://localhost:5173/admin/reset-password`.
4. **Authentication → Emails → SMTP Settings** *(recommended before launch)*: the built-in email service only sends a few emails per hour and is meant for testing. Connect a real sender (Resend, Postmark, Brevo, SendGrid…) so password-reset emails arrive reliably.
5. *(Optional)* Customise the **Invite** and **Reset password** email templates with the academy's name.

---

## Step 5. Create the owner account

1. **Authentication → Users → Add user → Send invitation**, using the owner's email. They get an email and choose a password. (Alternatively **Create new user** with a password and **Auto Confirm User** ticked, then share the password securely.)
2. Make that account an administrator. Open **SQL Editor** and run:
   ```sql
   insert into public.admin_roles (user_id, role, display_name)
   select id, 'owner', 'Owner Name'
   from auth.users
   where email = 'owner@example.com';
   ```
3. Check it: `select * from public.admin_roles;` should show one row.

Only SQL run here (or the service key) can add administrators. Nobody can
make themselves an admin from the website. The database tests prove this.

To add a second editor later, repeat both steps with `'editor'` as the role.
To remove someone: `delete from public.admin_roles where user_id = '…';`.

---

## Step 6. Deploy the comment function

```bash
# A random value used to anonymise IP addresses for rate limiting.
supabase secrets set COMMENT_IP_SALT="$(openssl rand -hex 32)"

# Which sites may post comments. Include the Netlify address and your domain.
supabase secrets set ALLOWED_ORIGINS="https://www.endowedacademy.com,https://<name>.netlify.app,http://localhost:5173"

supabase functions deploy submit-comment
```

`supabase/config.toml` sets `verify_jwt = false` for this function on
purpose. Visitors aren't signed in, and the function does its own checks:
the article must be published with comments open, input is validated,
bursts are rate-limited, and spam and blocked words are flagged. Supabase
gives the function its secret key automatically (`SUPABASE_SECRET_KEYS`, or
`SUPABASE_SERVICE_ROLE_KEY` on older projects).

**Check it:**
```bash
curl -s -X POST https://<project-ref>.supabase.co/functions/v1/submit-comment \
  -H "content-type: application/json" -H "apikey: <publishable key>" \
  -d '{"postId":"00000000-0000-0000-0000-000000000000","name":"Test","body":"hello"}'
# → {"error":"not_found"}   (correct: that article doesn't exist)
```

Later, if `ALLOWED_ORIGINS` changes, run the `secrets set` command again. If
the function code changes, run `functions deploy` again.

---

## Step 7. Try it on your computer first

1. Create `.env.local` in the project folder (copy `.env.example`):
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   ```
2. Run `npm run dev` and open `http://localhost:5173/admin`.
3. You should go straight to **Sign in** (there's no setup screen with Supabase). Sign in as the owner.
4. The note "Preview mode: articles are saved in this browser only" should be **gone** from the sidebar. That confirms you're on Supabase.
5. Write a short test article with an image and publish it. Open it in a private window, leave a comment, then approve it in the admin.

If anything fails here, fix it before deploying. See [Troubleshooting](#troubleshooting).

---

## Step 8. Deploy on Netlify

1. Netlify → **Add new project → Import an existing project → GitHub**, and pick the repository.
2. Build settings are read from `netlify.toml`: build command `npm run build`, publish directory `dist`. Leave them as they are.
3. Before the first deploy, open **Project configuration → Environment variables** and add:

   | Key | Value | Scopes |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` | **Builds** and **Functions** |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key | **Builds** and **Functions** |
   | `SITE_URL` | `https://www.endowedacademy.com` (or the netlify.app address for now) | **Functions** |

   *Builds* bakes the Supabase values into the site. *Functions* lets the
   edge functions (link previews, sitemap) read them. Netlify only applies
   variable changes on the **next deploy**.
4. **Deploy**. When it finishes, open the `…netlify.app` address.
5. **Custom domain:** Domain management → Add a domain, then follow Netlify's DNS instructions. HTTPS is issued automatically within minutes.
6. When the domain works, update three places to use it:
   - Netlify `SITE_URL`, then **Deploys → Trigger deploy**.
   - Supabase **URL Configuration** (Site URL and the reset-password redirect).
   - `ALLOWED_ORIGINS` (rerun the `supabase secrets set` command from step 6).

From now on, every push to `main` on GitHub deploys automatically. Pull
requests get a **Deploy Preview**. If previews shouldn't touch live data,
create a second Supabase project and set the variables for the *Deploy
Previews* context to that project's values.

---

## Step 9. Bring the content in

Sign in to the live admin and open **Import articles**:

- **From the browser preview:** upload the export file from step 0. Articles, images, categories, tags and approved comments come across. Published stays published with its original date. Drafts stay drafts.
- **Old Blogger posts:** upload the Blogger backup `.xml` (Blogger → Settings → Back up content).
- **Other files:** Word, Markdown, CSV or HTML, plus their images. Use `npm run bundle -- <folder>` to pack a folder into one file first if that's easier.

Web addresses that already exist are skipped, so running an import twice
never creates copies.

---

## Step 10. Launch checklist

- [ ] A published article opens directly at `https://<domain>/blog/<slug>`, and refreshing works.
- [ ] Refreshing on `/admin/posts` works (no 404).
- [ ] Pasting an article link into WhatsApp shows its title, summary and image. (WhatsApp caches previews; test with a new article.)
- [ ] `https://<domain>/sitemap.xml` lists published articles only, and `/robots.txt` points at it.
- [ ] A visitor can comment; the comment waits in **Comments → Waiting** until approved.
- [ ] A draft's address shows "This page isn't here." in a private window.
- [ ] **Forgot your password?** on the sign-in page sends an email, and the link opens the reset page.
- [ ] Brand settings saved in the admin show for readers in a private window.
- [ ] Optional: submit the sitemap in Google Search Console.

---

## Day-to-day

**Changing the site's code.** Commit and push to `main`. CI runs the tests and Netlify deploys.

**Changing the database.** Never edit tables by hand in the dashboard.
Create a migration, test it, then push it:
```bash
supabase migration new describe_the_change   # creates supabase/migrations/<timestamp>_describe_the_change.sql
# write the SQL, then locally:
npm run test:db                              # runs every migration + the security tests on a scratch database
supabase db push                             # applies it to the live project
```

**Changing the comment rules.** Edit `src/features/comments/moderation.ts`,
run `npm run sync:shared` to copy it into the Edge Function, then
`supabase functions deploy submit-comment`. A unit test fails if the two
copies drift.

**Backups.** Supabase Pro includes daily backups (and point-in-time
recovery as an add-on). On the free plan, run `supabase db dump -f backup.sql`
regularly. Separately, **Import articles → Export all articles** produces a
full content backup, with images, that the importer can restore.

**Rotating keys.** In **Project Settings → API Keys**, create a new
publishable key. Update it in Netlify, redeploy, then delete the old key.
Edge Functions pick up secret-key changes automatically.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sidebar still says "Preview mode" on the live site | The Supabase variables were missing at build time | Add both `VITE_` variables with the **Builds** scope, then **Trigger deploy** |
| "This account isn't an administrator for this site" | No `admin_roles` row | Run the SQL in step 5 |
| "That email and password don't match" for an invited user | They haven't accepted the invitation yet | Resend the invite, or set a password under Authentication → Users |
| Comments: "couldn't be sent" | Function not deployed, or the site isn't in `ALLOWED_ORIGINS` | Redo step 6; check **Edge Functions → submit-comment → Logs** |
| Comments: "posted several comments in a short time" | Rate limit (4 per 10 minutes per visitor) | Expected; wait 10 minutes |
| Image upload fails | Bucket or policies missing | Check `supabase db push` ran all 4 migrations; Storage should show a public `media` bucket |
| Reset email never arrives | Built-in email limits | Set up custom SMTP (step 4) |
| Reset link opens the home page | Redirect URL not allowed | Add `/admin/reset-password` URLs in step 4 |
| Link previews show the generic title | `SITE_URL`/Supabase variables lack the **Functions** scope, or the article isn't published | Fix scopes and redeploy; check the article opens in a private window |
| Browser console shows a Content Security Policy error | A custom Supabase domain is in use | Add that domain to `connect-src` in `netlify.toml` |

---

## How this was tested before handover

The Supabase path was run end to end against a local stand-in made of the
real **Supabase Auth (GoTrue v2.180)** and **PostgREST v12** binaries, a
PostgreSQL 16 database with these exact migrations, and the real
`submit-comment` function. Storage was simulated by a small stand-in that
enforces the same admin check. See `tests/supabase-local/`.

| Suite | Result |
|---|---|
| `tests/e2e/supabase.spec.ts` (9 tests) | Sign-up closed and non-admins refused; write, upload, autosave and publish, then read as a visitor; Postgres full-text search; comments through the function (spam caught server-side, direct inserts refused, approval); two-tab conflict detection; bulk import with images and comments; settings, featuring, trash, in-use image protection; **preview export → Supabase import**; endpoint validation and rate limiting; password-reset request and sign-out |
| `tests/supabase-local/edge-check.mjs` | Netlify edge functions inject title, Open Graph, canonical URL and JSON-LD; drafts aren't leaked; the sitemap lists published articles only; robots.txt is correct |
| `tests/db` (38 checks) | Row Level Security and grants for visitors, signed-in non-admins and admins |

What hasn't been tested is the real hosted Supabase Storage service, real
email delivery and Netlify's own runtime. Step 7 and the launch checklist
cover those on the live accounts.
