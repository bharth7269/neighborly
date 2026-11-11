# Security model

**Principle:** the browser is untrusted. Every rule that matters is enforced in
the database or an Edge Function, and covered by `supabase/tests/10_security_tests.sql`.

## Threats and controls

| Threat | Control | Where |
|---|---|---|
| Outsider reads a circle's items, people or chats | Row-level security on every table; anonymous role has no grants | `0002_security.sql` |
| Member reads another member's flat number | `unit_label` column not granted; revealed only by `get_loan_contact` after approval, or to staff | `0002`, `0003` |
| Borrower marks a loan returned, or edits status | No insert/update grants on `loans`; all transitions in `SECURITY DEFINER` functions with row locks | `0003` |
| Self-boosting trust score | Column not grantable + guard trigger; points only via `trust_events`; capped per pair (3 / 30 days) and per week (+15) | `0002`, `0003` |
| Faking the handover without meeting | One-time 128-bit QR code, 5-minute expiry, only its SHA-256 stored, single use | `issue_handover_code`, `confirm_handover` |
| Forging or deleting condition photos | Clients cannot write to the evidence bucket; the Edge Function sniffs file bytes, hashes on the server, chooses the path, `upsert:false`; DB stamps server time | `functions/handover-photo` |
| Photo location leaks home address | Photos re-encoded in the browser, which strips EXIF/GPS | `web/src/lib/image.ts` |
| Brute-forcing invite codes | 40-bit codes, 10 attempts/hour/user; failed attempts still count (return NULL, not an exception, so the limit isn't rolled back) | `join_circle` |
| Spam / abuse | Per-user rate limits on requests, chat (20/min), handovers, disputes, reports | `private.rate_limit` |
| Moderator abuse | Moderators can't resolve disputes they're part of; admins can't be suspended by moderators; all actions audited | `resolve_dispute`, `suspend_member`, `private.audit_log` |
| Path traversal / foreign files in item photos | Storage policies check the item owner from the path; trigger validates each `photo_paths` entry by regex | `0004`, `items_guard` |
| SQL injection | No dynamic SQL; PostgREST parameterises; functions use `search_path = ''` and fully-qualified names | all migrations |
| XSS | React escapes output; strict CSP (`script-src 'self'`); notification links limited to internal paths | `vercel.json`, `Alerts.tsx` |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `vercel.json` |
| Session theft | PKCE flow, 1-hour JWTs, refresh-token rotation, HSTS | `supabase.ts`, `config.toml` |
| Leaking internals in errors | Only short human-readable DB messages are shown; anything else becomes a generic message | `errors.ts`, `_shared/http.ts` |
| Leaked secrets | Only the public anon key is in the client; service key only in Edge Functions; gitleaks in CI | `.env.example`, `ci.yml` |
| Vulnerable dependencies | `npm audit --audit-level=high` in CI | `ci.yml` |
| Right to erasure (DPDP Act) | `delete-account` function; blocked while a loan is live; cascades personal data | `functions/delete-account` |

## Known limits (be honest with users)
- "Live" photos can't be fully proven in a web app: a person could photograph a screen. Server timestamps, hashes and both-party photos make this hard and visible to moderators.
- Deposits are recorded, not held. Until Razorpay is integrated, moderators decide how a deposit is split but cannot move money.
- Circle admins vouch for residents; the app does not verify identity documents.

## Reporting a vulnerability
Email [SECURITY CONTACT]. Please don't open public issues for security reports.
