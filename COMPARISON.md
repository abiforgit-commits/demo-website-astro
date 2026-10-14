# Next.js vs Astro: comparison results

Run on 2026-10-15 with `npm run compare`, Windows 11, Microsoft Edge 155 (Chromium) through Playwright. Both apps were built from scratch with the same environment and served in production mode: Next.js with `next start`, Astro from its Vercel build output.

## Result: 79 of 79 checks identical

| Area | Checks | What is compared |
|---|---|---|
| Visual | 10 | Full-page screenshots of `/`, `/about`, `/services`, `/contact` and the 404 page at 1440px and 390px, pixel by pixel with zero tolerance. 0 differing pixels on every page. |
| DOM | 5 | Every element, attribute, class and text node in `<body>`. |
| Head | 5 | Title, description, canonical, Open Graph, Twitter, robots, icon, JSON-LD. |
| Behaviour | 18 | Mobile menu, active link, client-side navigation without reload, back-to-top, light/dark header after navigation, DOM after navigation, contact form states (no token, server error, success). |
| Form memory | 6 | Typed text and error message surviving navigation away and back, by link and by back button. |
| API | 18 | Validation errors, spam check pass/fail, database failure, cross-site requests, GET/HEAD/PUT/PATCH/DELETE/OPTIONS. Status, content type and body. |
| HTTP | 16 | `robots.txt`, `sitemap.xml` (byte-identical), favicon and images (identical bytes), the missing `/og-image.png`, 404 status, trailing-slash redirect. |
| Build | 1 | Building without `RESEND_API_KEY` fails in both. |

Not compared: response headers that only identify the framework (`x-powered-by`, `vary`, cache headers), and framework-only markup (script tags, preload hints, route announcers, React's hidden placeholder `<div>`).

## Size and speed

Per page at first load, measured in the browser. Third-party requests (spam check, map) are blocked so only the app's own files count.

| Page | | Requests | HTML | JavaScript | JS (gzip) | CSS | Fonts | Total (gzip) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `/` | Next.js | 12 | 39.1 KB | 484.9 KB | 146.0 KB | 31.5 KB | 99.3 KB | 259.3 KB |
| | Astro | 8 | 25.0 KB | 16.4 KB | 5.9 KB | 29.2 KB | 99.3 KB | 116.9 KB |
| `/about` | Next.js | 12 | 39.5 KB | 484.9 KB | 146.0 KB | 31.5 KB | 99.3 KB | 258.7 KB |
| | Astro | 8 | 24.8 KB | 16.4 KB | 5.9 KB | 29.2 KB | 99.3 KB | 116.4 KB |
| `/services` | Next.js | 12 | 30.4 KB | 484.9 KB | 146.0 KB | 31.5 KB | 99.3 KB | 257.8 KB |
| | Astro | 8 | 20.8 KB | 16.4 KB | 5.9 KB | 29.2 KB | 99.3 KB | 116.0 KB |
| `/contact` | Next.js | 20 | 28.3 KB | 508.6 KB | 154.8 KB | 31.5 KB | 99.3 KB | 279.3 KB |
| | Astro | 8 | 23.9 KB | 16.4 KB | 5.9 KB | 29.2 KB | 99.3 KB | 117.7 KB |

- **JavaScript:** Astro sends about 25× less (5.9 KB vs 146 KB gzipped). The Next.js figure is mostly React and the Next.js router; Astro's is its client router, link prefetching, and the menu and form scripts.
- **Total page weight:** less than half (about 117 KB vs 258–279 KB gzipped). The fonts are the same 99 KB in both apps.
- **Prefetching after load:** Next.js makes 9 requests for page data, Astro 3 for the other pages' HTML.
- **Build time:** 11.2s (Next.js) vs 7.8s (Astro) in this run. Earlier runs on the same machine gave 17.8s vs 16.7s and 11.4s vs 10.3s, so treat this as roughly equal, with Astro slightly faster.

The numbers were measured on localhost, uncompressed, with gzip sizes computed from the bodies. Vercel's real transfer sizes will differ (Brotli, CDN), but the ratio should hold.

## Next.js behaviours the Astro copy reproduces on purpose

Making the output identical meant copying several things Next.js does implicitly, including two bugs.

| Next.js behaviour | How the Astro copy matches it |
|---|---|
| **The custom fonts never display.** `next/font` sets `--font-inter` and `--font-unbounded` on `<body>`, but `globals.css` reads them at `:root` (Tailwind `@theme`), so `--font-sans` is invalid and every page renders in the system font (Segoe UI on Windows). The font files are still downloaded. | The fonts are registered under internal names and the two variables are set on `<body>` ([BaseLayout.astro](src/layouts/BaseLayout.astro)), so the same fallback happens. |
| The build evaluates `lib/email.ts`, so it fails without `RESEND_API_KEY`. | `astro build` imports `lib/email.ts` ([astro.config.mjs](astro.config.mjs)). |
| `cacheComponents` keeps the 3 most recently visited routes alive, so the contact form keeps typed text and messages when you come back. | [ContactForm.astro](src/components/ContactForm.astro) keeps the form state while `/contact` is among the 3 most recent routes. |
| React writes adjacent text as separate text nodes (`About <!-- -->Frisk`), which shifts glyph positions by a fraction of a pixel. | The same `<!-- -->` splits are written in the five places React adds them. |
| Unsupported methods on `/api/contact`: `405`, or `204` with `Allow: OPTIONS, POST`. No cross-site form check. | An `ALL` handler returns the same responses; Astro's `checkOrigin` is off. |
| `next/image` with an SVG renders a plain `<img>` with an inline fill style. | [Photo.astro](src/components/Photo.astro) outputs the same tag. |
| Client-side navigation with viewport prefetching. | `<ClientRouter />` with viewport prefetch and no transition animation. |
| Spam-check widget rendered by `@marsidev/react-turnstile`. | The same Cloudflare script URL, script id, container and widget options, in plain JavaScript. |

### Issues in the Next.js app worth fixing (in both apps)

These are copied faithfully, so fixing one app means making the same change in the other:

1. **Fonts don't display.** The usual fix for this Tailwind v4 setup is `@theme inline { ... }` instead of `@theme { ... }` in `globals.css` / `global.css`. It is untested here, and fixing it changes how both sites look.
2. **The build fails without `RESEND_API_KEY`.** Create the Resend client inside `sendContactEmail` instead of at module load.
3. **The spam check isn't reset after a failed submit.** A Turnstile token works only once, so a retry after any server error fails with "Spam check failed" until the token expires.
4. **`/og-image.png` doesn't exist**, so link previews have no image.

## What was not verified

- **Saving to the database and sending email.** No MySQL server was available, so both apps were tested up to the insert (both return `500 Server error`), and the success screen was tested with a mocked API response. Test the full path with real credentials after deploying.
- **Vercel itself.** Astro was served by a local emulator of Vercel's build output ([compare/vercel-local.mjs](compare/vercel-local.mjs)), not a real deployment.
- **Other browsers.** Only Chromium (Edge) was used. Firefox and Safari render text differently, but they would render both apps the same way, since the DOM and CSS are identical.
