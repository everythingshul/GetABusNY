# Get A Bus NY

Public website + admin back office + driver/vendor portals + Chesky assistant. Node 22+, Express, built-in SQLite. One dependency (`express`).

```bash
npm install
cp .env.example .env   # fill in keys; export them or use your host's env settings
npm start              # http://localhost:3000  (admin at /admin)
npm test               # 29-step end-to-end check on a throwaway database
```

First run prints the admin email/password (or uses `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Pages
Public: `/` `/fleet` `/book` `/about` `/contact` `/terms` `/pay` · Customer links: `/quote/<token>`, `/pay/<token>` · Drivers: `/d/<token>` (no password) · Vendors: `/v/<token>` (no login) · Admin: `/admin`

## Flow
Lead (`/book` or Chesky) → Quote (admin) → customer accepts → Trip + Invoice created → deposit paid via Stripe → trip auto-confirmed → driver assigned → driver portal → follow-ups/thank-you.
Vendors: send a quote request from a lead or trip; vendors reply by private link; award → cost and margin tracked on the trip.

## Features added in v2
Itinerary builder (start / pickups / stops / drop-offs / return pickups, per-stop time, wait, notes) · Google address suggestions everywhere an address is typed · e-signature contracts with signed PDF · text alerts through SimpleSender (opt-in, customers pick which kinds, Shabbos quiet window, STOP handling), per-admin alert choices by email and text, a Sent messages log that shows every email and text as received, bus-safe routing with ETAs (HERE) · Google review requests · dispatch calendar feeds (.ics) · Excel export of every table · Chesky (ported from JListings) with taught answers and human handoff · first-party website traffic.

Pricing is always entered by hand. The itinerary only generates empty line items and an optional drive-time estimate.
Photos: upload vehicle photos only. No people in any picture.

## Deploy notes
- Needs a host with a persistent disk. `render.yaml` is ready for Render (same host as JListings). Back the disk up.
- Serve over HTTPS and set `BASE_URL` (used in every emailed link and Stripe redirect).
- Stripe: add the webhook endpoint from `.env.example`. Without it, payments won't be recorded automatically.
- Follow-ups run from an in-process timer, so keep one instance running.
