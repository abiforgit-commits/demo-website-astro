import type { APIRoute } from "astro";

// Same output as Next.js MetadataRoute.Sitemap with only `url` set.
export const GET: APIRoute = () => {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const urls = ["", "/about", "/services", "/contact"]
    .map((path) => `<url>\n<loc>${base}${path}</loc>\n</url>\n`)
    .join("");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls +
    `</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
