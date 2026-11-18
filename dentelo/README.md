# Dr. Ahmed Dental Clinic — website

Clinic website with online appointment booking, call-back requests, a password-protected
bookings admin, and the embedded 3D teeth explorer.

```
dentelo/
├── public/            static site served as-is (index.html, assets/, explorer/)
├── api/               Vercel functions: /api/config, /api/availability, /api/bookings, /admin
├── lib/               shared logic: clinic rules (clinic.mjs), storage (store.mjs), handlers (app.mjs)
├── server.mjs         local / self-hosted server using the same lib/ code
├── vercel.json        Vercel config (output dir, rewrites, headers)
└── scripts/build-explorer.sh   rebuilds public/explorer from ../dental-scope
```

No npm dependencies and no build step: Vercel serves `public/` from its CDN and runs `api/` as Node functions.

## Deploy to Vercel

1. **Import the repo** at <https://vercel.com/new>.
   - **Root Directory:** `dentelo` (important — the repo also contains the `dental-scope` source).
   - Framework preset: **Other**. Leave build and output settings at their defaults; `vercel.json` sets them.
2. **Add booking storage.** In the project, open **Storage → Create / Connect → Upstash (Redis)**,
   create a free database and connect it to the project. That adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically. (Vercel's disk is read-only, so bookings cannot be kept in a file there.)
3. **Set environment variables** under **Settings → Environment Variables**:

   | Name | Example | Purpose |
   |---|---|---|
   | `ADMIN_PASSWORD` | a long random string | Password for `/admin` (user name `admin`). Required. |
   | `CLINIC_TZ` | `Asia/Karachi` | Clinic time zone ([IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)). Vercel runs on UTC, so without this "today" and past-slot checks use UTC. |

4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables take effect.

Check it: open the site, book a test appointment, then go to `https://<your-domain>/admin`.

Until storage is connected, the booking API answers `503 Booking storage is not configured`, and
`/admin` answers `503` until `ADMIN_PASSWORD` is set.

## Run locally

Requires Node 20+.

```bash
cd dentelo
npm start                     # → http://localhost:5500
# optional:
PORT=8080 ADMIN_PASSWORD=secret CLINIC_TZ=Asia/Karachi npm start
```

Locally, bookings are saved to `data/bookings.json`. If `ADMIN_PASSWORD` is not set, a password is
generated into `data/admin-password.txt`. `data/` is git-ignored. Set `KV_REST_API_URL` /
`KV_REST_API_TOKEN` to use the same Redis database as production instead.

## Rebuilding the 3D explorer

`public/explorer` is a prebuilt copy of `../dental-scope`. After changing the explorer:

```bash
cd dental-scope && npm ci && cd ../dentelo
npm run build:explorer
```

## Before going live

- Replace the placeholder address, phone and email in `public/index.html`.
- Add your custom domain under **Settings → Domains**.

## Credits

Based on the Dentelo template by codewithsadee. 3D anatomy and tooth texts from Dental Scope (MIT,
CC BY-SA 4.0); models from BodyParts3D © DBCLS (CC BY-SA 2.1 JP). See `public/explorer/CREDITS.md`.
