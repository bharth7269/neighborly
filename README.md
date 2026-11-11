# Neighborly

Borrow and lend things with verified neighbours in your apartment society or campus.
Each society is a **Circle**. Members are approved by the circle admin, and every
handover is confirmed with a one-time QR code and condition photos from both people.

```
web/                 React + TypeScript PWA (Vite, Tailwind)
supabase/migrations  Database schema, row-level security, server functions
supabase/functions   Edge Functions: handover-photo, delete-account
supabase/tests       Security & state-machine tests (run on plain Postgres)
.github/workflows    CI: lint, typecheck, unit tests, build, DB tests, secret scan
SECURITY.md          Threat model and every security control
```

## How a loan works

```
requested ──owner approves──▶ approved ──QR + photos from both──▶ active
    │                            │                                   │
 declined / cancelled        cancelled                 QR + photos from both
                                                                     ▼
          completed ◀──owner accepts, or 24 h pass── returned ──problem──▶ disputed ──moderator──▶ resolved
```

All of these transitions happen **only inside database functions**. The app cannot
change a loan, a trust score or a membership directly.

---

## Set up (about 30 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) and create a project. Pick the **Mumbai** region and a strong database password.
2. Install the CLI: `npm i -g supabase`, then in this folder:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push                 # applies the 4 migrations
   supabase functions deploy handover-photo
   supabase functions deploy delete-account
   supabase secrets set ALLOWED_ORIGINS=https://your-app.vercel.app,http://localhost:5173
   ```
3. Dashboard → **Database → Extensions**: enable `pg_cron`, then run `supabase db push` again so the scheduled jobs are created (auto-complete returns after 24 h, overdue reminders, cleanup).

### 2. Configure sign-in
Dashboard → **Authentication**:
- **Providers → Email**: enabled, “Confirm email” on.
- **Email Templates → Magic Link**: include `{{ .Token }}` so people receive a 6-digit code (the app uses codes, not links).
- **URL Configuration**: Site URL = your production URL; add `http://localhost:5173` as a redirect URL.
- **Rate Limits**: keep the defaults or lower them.
- **SMTP**: before launch, connect your own email sender (e.g. Resend, Amazon SES). The built-in sender is limited to a few emails per hour.
- Optional, for phone login and premium items: **Providers → Phone** with MSG91 or Twilio. In India you also need DLT registration for SMS templates. Then set `VITE_ENABLE_PHONE_AUTH=true`.

### 3. Run the app locally
```bash
cd web
cp .env.example .env.local     # paste Project URL and anon key from Settings → API
npm install
npm run dev                    # http://localhost:5173
```
Sign in, **Start a new circle**, then share the invite code with a second account to test lending end to end.

### 4. Deploy to Vercel
1. Push this folder to a **private** GitHub repo.
2. In Vercel: **New Project** → import the repo → Root Directory `web`.
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy. `web/vercel.json` already sets the security headers and SPA routing.
5. Add the Vercel URL to Supabase Site URL / redirect URLs and to `ALLOWED_ORIGINS`.

---

## Tests

```bash
# Unit tests, typecheck, lint, build
cd web && npm test && npm run typecheck && npm run lint && npm run build

# Database security tests: needs any Postgres 15+ you can create databases on
PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh
```

The database suite signs in as five different people and checks more than 60
rules. Among them: outsiders see nothing, borrowers can't edit loans, QR codes
expire and can't be reused, photos can't be forged, trust farming is capped,
invite-code guessing is rate-limited, and moderators can't judge their own disputes.

## Production checklist

- [ ] Own SMTP sender configured; email template shows `{{ .Token }}`
- [ ] `pg_cron` enabled and jobs visible under Database → Cron
- [ ] Point-in-time recovery / daily backups enabled (Pro plan)
- [ ] `ALLOWED_ORIGINS` set to the production domain only
- [ ] Supabase **Advisors → Security** shows no warnings
- [ ] Terms and Privacy pages (`web/public/*.html`) completed and reviewed by a lawyer
- [ ] Grievance officer named in the privacy policy (DPDP Act)
- [ ] Error monitoring (e.g. Sentry) added
- [ ] GitHub branch protection: CI must pass before merging to `main`

## What's next (from the SDLC plan)
- Razorpay for deposits and paid rentals (deposits are currently agreed in the app and settled in person)
- Push notifications (FCM) and WhatsApp reminders
- Offline support via a service worker
- Hindi / Tamil interface
