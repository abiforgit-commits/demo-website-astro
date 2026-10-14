import type { APIRoute } from "astro";

// Same output as Next.js MetadataRoute.Robots for { userAgent: "*", allow: "/" }.
export const GET: APIRoute = () => {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const body = `User-Agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
