# Clipticket

A no-login clipboard/file drop that syncs instantly across devices via a
short "ticket" code — the thing you were using Telegram-to-self for.

- Take a ticket (or type one in) → land on `/r/XXXX-XXXX`
- Type text or drop files → every other device on that ticket updates in
  real time (Supabase Realtime, no polling)
- Files up to 100MB, text unlimited-ish (Postgres `text` column)
- Pick how long the ticket sticks around: 1h / 24h / 7d / 30d
- QR code on the room page for pairing a phone in one scan
- Zero accounts, zero passwords — the code itself is the key. Anyone with
  the code can read/write that room, so don't put anything in it you
  wouldn't paste into an unlisted note.

Stack: **Next.js 14 (App Router) + Supabase** (Postgres, Realtime, Storage).
Both have free tiers generous enough for personal + small-scale multi-user
use, and it's a single service to run instead of stitching together a
websocket server, a database, and object storage separately.

---

## 1. Get the code running locally

```bash
npm install
cp .env.example .env.local   # fill in after step 2 below
npm run dev
```

Opens on `http://localhost:3000`. It won't work yet — it needs a Supabase
project first.

---

## 2. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up (free, no card) →
   **New project**.
2. Pick a name, a database password (save it somewhere), and a region
   close to you. Wait ~2 minutes for provisioning.
3. In the project, go to **Settings → API**. You'll need two values:
   - **Project URL**
   - **anon / public** key (not the `service_role` one — that one's
     secret and never goes in frontend code)
4. Paste both into `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

---

## 3. Set up the database, storage bucket, and Realtime

1. In the Supabase dashboard, open **SQL Editor**.
2. Open `supabase/schema.sql` from this repo, copy the whole file, paste
   it into the editor, click **Run**.

That single script:
- creates the `rooms` and `room_files` tables
- turns on Realtime for both (so edits push to every open tab instantly)
- sets Row Level Security policies that allow anonymous read/write —
  intentional, since there's no login; the room code is the access
  control
- creates the `clipticket-files` storage bucket (public read, so
  download links work directly) with matching policies

No manual clicking needed beyond running that script — it's all
idempotent, so re-running it is safe.

---

## 4. Turn on the expiry cleanup job (optional but recommended)

Rooms get an `expires_at` timestamp, but nothing deletes them
automatically unless you turn on the scheduled job:

1. **Database → Extensions** → search "pg_cron" → enable it.
2. Back in **SQL Editor**, run:
   ```sql
   select cron.schedule(
     'purge-expired-rooms',
     '0 * * * *',
     $$select public.purge_expired_rooms();$$
   );
   ```
   That runs the cleanup function hourly. It deletes expired `rooms`
   rows (and their `room_files` rows via cascade).

**One gap to know about:** that cascade removes the *database rows*, not
the actual files sitting in Storage — Postgres cascades don't reach into
the Storage service. For a personal/small-scale tool this is usually
fine to leave (Storage free tier is 1GB, files are capped at 100MB each
so you'd need a lot of abandoned rooms to matter). If you want it fully
tidy, add a Supabase **Edge Function** on a schedule that lists objects
under expired room codes and calls `storage.remove()` on them before the
SQL delete runs — happy to build that out if you hit the storage limit.

---

## 5. Deploy it (Vercel, free tier)

1. Push this project to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → sign in with GitHub → **Add
   New → Project** → pick the repo.
3. Vercel auto-detects Next.js, no build config needed.
4. Before deploying, add the environment variables: **Settings →
   Environment Variables**, add both `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same values as your `.env.local`).
5. Click **Deploy**. ~1 minute later you get a `https://your-app.vercel.app`
   URL — that's the site, live, free, on Vercel's global CDN.
6. Optional: **Settings → Domains** to attach a domain you own.

Every push to your GitHub repo's main branch auto-redeploys.

---

## 6. Using it day to day

- On your main device: hit the site, **Take a ticket**, paste your text
  or drop a file.
- On the new device: either scan the QR code shown on the room page, or
  type the ticket code into the **Have a ticket already?** box on the
  home page.
- Bookmark a specific ticket's URL (`/r/XXXX-XXXX`) if you want a
  permanent "my clipboard" link instead of taking a new one each time —
  just keep bumping its expiry so it doesn't get purged.

---

## Known limits (free-tier reality, not artificial restrictions)

| Limit | Why |
|---|---|
| 100MB per file | Vercel free tier serverless functions and Supabase Storage free tier (1GB total) both get tight above this; raise `MAX_FILE_BYTES` in `lib/supabaseClient.ts` if you upgrade either plan |
| Upload shows a spinner, not a % progress bar | `supabase-js`'s storage upload doesn't expose progress events in v2. Fixable by swapping to a raw `fetch` with `XMLHttpRequest.upload.onprogress`, or Supabase's resumable (TUS) upload client — flagged here as a next step, not built now since it adds real complexity for a "nice to have" |
| Anyone with the code has full access | No accounts by design. Don't reuse a ticket code as a long-term secret store |
| Supabase free tier: 500MB database, 1GB storage, 2GB bandwidth/month | Fine for personal use and a modest number of users; the schema is portable to a paid tier with zero code changes if you outgrow it |

---

## Project structure

```
app/
  page.tsx              landing page — take/claim a ticket
  r/[code]/page.tsx      room route
  layout.tsx, globals.css
components/
  ClipboardRoom.tsx      the whole room experience: text sync, files, QR, expiry
lib/
  roomCode.ts             ticket code generation/validation
  expiry.ts               expiry option definitions + formatting
  supabaseClient.ts       Supabase client singleton
supabase/
  schema.sql              full DB + storage + RLS setup, paste-and-run
```
