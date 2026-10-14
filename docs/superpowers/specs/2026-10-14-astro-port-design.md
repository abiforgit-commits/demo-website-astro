# Astro port of demo-website: design

Date: 2026-10-14
Source app: `../demo-website` (Next.js 16.4.0, React 19.3.0, Tailwind 4.3.3)

## Goal

A full Astro copy of the Next.js demo-website for a side-by-side comparison. Both apps deploy to Vercel. **The output of both apps must be the same**: visuals, page content, metadata, navigation behaviour, contact form behaviour and API responses. Quirks are copied, not fixed (missing `/og-image.png`, spam-check widget not reset after a failed submit).

## Stack

| Concern | Next.js app | Astro app |
|---|---|---|
| Framework | next 16.4.0 | astro 7.3.5 |
| Hosting | Vercel | Vercel, `@astrojs/vercel` 11.0.11 |
| CSS | Tailwind 4.3.3 via PostCSS | Tailwind 4.3.3 via `@tailwindcss/vite` |
| Fonts | `next/font/google` (Inter 100–900, Unbounded 200–900, self-hosted, fallback metrics) | Astro Fonts API, Google provider, same weight ranges, self-hosted, fallback metrics |
| Server libs | mysql2 3.24.5, resend 6.32.1, zod 4.6.5 | same exact versions |
| After-response work | `after()` from `next/server` | `waitUntil()` from `@vercel/functions` |
| Spam check | `@marsidev/react-turnstile` | Cloudflare `api.js` loaded with the same script id, URL and widget options |
| Client navigation | Next router, viewport prefetch | Astro `<ClientRouter />`, viewport prefetch, no transition animation |

No React in the Astro app.

## Rendering

All pages are prerendered. Only `/api/contact` runs on demand (`export const prerender = false`), matching the Next build (`○` pages, `ƒ /api/contact`). URLs have no trailing slash.

## File mapping

```
src/styles/global.css          ← app/globals.css (verbatim)
src/lib/site.ts, theme.ts      ← lib/site.ts, lib/theme.ts (verbatim)
src/lib/db.ts, email.ts        ← lib/db.ts, lib/email.ts (verbatim)
src/layouts/BaseLayout.astro   ← app/layout.tsx (+ Next metadata output)
src/components/*.astro         ← app/components/*.tsx (all 9, including the unused PageHero)
src/pages/index.astro          ← app/page.tsx
src/pages/about.astro          ← app/about/page.tsx
src/pages/services.astro       ← app/services/page.tsx
src/pages/contact.astro        ← app/contact/page.tsx
src/pages/404.astro            ← app/not-found.tsx
src/pages/robots.txt.ts        ← app/robots.ts
src/pages/sitemap.xml.ts       ← app/sitemap.ts
src/pages/api/contact.ts       ← app/api/contact/route.ts
public/                        ← favicon.ico, images/placeholder.svg
```

## Output parity rules

- **Head:** same `<title>` (template `%s | Frisk`, home uses the absolute title), description, canonical (`http://host` for home, `http://host/about` etc.), `og:*`, `twitter:*`, JSON-LD, icon. 404 adds `robots: noindex` and has no canonical.
- **Body:** same elements, classes, attributes and text as the Next HTML. Images render as `<img>` with the Next `fill` inline style, `decoding="async"`, `loading="lazy"` unless `priority`.
- **Header/Footer:** light or dark variant decided by `isLightPage(pathname)` at build time; mobile menu toggled by a small script that sets `hidden`, `aria-expanded` and `aria-label` like the React state did.
- **Contact form:** same markup, same states and messages, same Turnstile options (`theme: light`, `render=explicit`, `onload=onloadTurnstileCallback`, script id `cf-turnstile-script`, container `#cf-turnstile`). Token is not reset after an error. Script initialises on `astro:page-load` and removes the widget when leaving the page.
- **API:** same validation, status codes, JSON bodies and log messages. Unsupported methods return the same response as Next.
- **Env vars:** same names as the Next app (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `DB_*`, `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`), so one `.env` serves both.

## Verification (`npm run compare`)

Run both production builds side by side, then:

1. **Visual:** full-page screenshots of `/`, `/about`, `/services`, `/contact`, 404 at 1440px and 390px, pixel-diffed. Reduced motion on; Google Map and Turnstile iframes masked.
2. **Content:** per page, compare visible text, headings, links and targets, image attributes, head metadata, JSON-LD. Framework-only tags ignored.
3. **Behaviour:** mobile menu, active link, client-side navigation without reload, back-to-top, header/footer theme after navigation, form "complete the spam check" message.
4. **API:** bad JSON, invalid fields, fake token, Turnstile test keys without DB (expect `500 Server error`), GET/PUT. Compare status, body, headers.
5. **robots.txt / sitemap.xml:** byte-identical.
6. **Build without `RESEND_API_KEY`:** record outcome.

Results and metrics (build time, client JS per page, page weight, requests, HTML size) go in `COMPARISON.md`.

## Out of scope

Creating the GitHub repo and the Vercel project (needs the owner's accounts); README documents the steps.
