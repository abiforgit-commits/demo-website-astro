# demo-website-astro

An Astro copy of [`demo-website`](https://github.com/sudhersun/demo-website) (Next.js), built for a side-by-side comparison. Both apps produce the same output: the same pages, design, metadata, client-side navigation, contact form and API responses. `npm run compare` checks this automatically.

## Stack

- Astro 7 with the Vercel adapter. Pages are prerendered; only `POST /api/contact` runs as a serverless function.
- Tailwind CSS 4 (same version and the same `global.css` as the Next.js app).
- Inter and Unbounded, self-hosted through Astro's built-in fonts feature.
- Contact form: Cloudflare Turnstile spam check, then a MySQL insert (`mysql2`), then an email through Resend.

## Run locally

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # production build into .vercel/output
npm run check      # type and template checks
```

## Environment variables

The names are the same as in the Next.js app, so one `.env` file works for both.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, OG image URL, `robots.txt`, `sitemap.xml` (build time) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Spam-check widget in the browser (build time) |
| `TURNSTILE_SECRET_KEY` | Spam-check verification in `/api/contact` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `DB_SSL`, `DB_CA` | Set `DB_SSL=true` and the CA certificate for managed MySQL |
| `RESEND_API_KEY` | Resend client. The build fails without it, as in the Next.js app |
| `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` | Sender and recipient of contact emails |

The API inserts into a `contact_submissions` table with the columns `name`, `email`, `phone`, `message` and `ip`, which is the same table the Next.js app uses.

## Deploy to Vercel

1. Create a new GitHub repository and push this folder to it.
2. In Vercel, choose **Add New → Project** and import the repository. Vercel detects Astro automatically.
3. Add the environment variables above, using the same values as the Next.js project.
4. Deploy.

## Compare with the Next.js app

```bash
npm run compare             # builds both apps, then runs every check
npm run compare -- --no-build
```

The script expects the Next.js app in `../demo-website` (set `NEXT_APP_DIR` to change this) with its dependencies installed. It builds both apps with Cloudflare's Turnstile test keys, starts both in production mode, and compares:

- full-page screenshots, pixel by pixel, of every page at desktop and phone widths
- head metadata and the full body DOM of every page
- behaviour: mobile menu, client-side navigation, back-to-top, contact form states
- API responses for valid, invalid and unsupported requests
- static files, `robots.txt`, `sitemap.xml`, status codes and redirects

Screenshots, diff images and `report.json` are written to `compare/output/`. The results and size metrics are summarised in [COMPARISON.md](COMPARISON.md).
