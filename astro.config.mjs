// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

// Load .env files into process.env the way Next.js does, so the same .env
// works for both apps and lib/db.ts + lib/email.ts can read process.env.
const mode = process.argv.includes("dev") ? "development" : "production";
for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
  process.env[key] ??= value;
}

// `next build` evaluates the /api/contact route module, so lib/email.ts runs
// `new Resend(...)` at build time and the build fails without RESEND_API_KEY.
// Evaluate the same module during `astro build` so both builds behave alike.
if (process.argv.includes("build")) {
  await import("./src/lib/email.ts");
}

export default defineConfig({
  site: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  output: "static",
  adapter: vercel(),
  trailingSlash: "never",
  build: { format: "file" },
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  // Next.js has no built-in cross-site form check; without this, Astro answers
  // some cross-origin requests with 403 where Next.js answers 400/405.
  security: { checkOrigin: false },
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Inter",
      cssVariable: "--astro-font-inter",
      weights: ["100 900"],
      styles: ["normal"],
      subsets: ["cyrillic-ext", "cyrillic", "greek-ext", "greek", "vietnamese", "latin-ext", "latin"],
      display: "swap",
    },
    {
      provider: fontProviders.google(),
      name: "Unbounded",
      cssVariable: "--astro-font-unbounded",
      weights: ["200 900"],
      styles: ["normal"],
      subsets: ["cyrillic-ext", "cyrillic", "vietnamese", "latin-ext", "latin"],
      display: "swap",
    },
  ],
  vite: {
    plugins: [tailwindcss()],
    // Inline NEXT_PUBLIC_* values into browser code at build time, as Next.js does.
    define: {
      "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY":
        JSON.stringify(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) ?? "undefined",
    },
  },
});
