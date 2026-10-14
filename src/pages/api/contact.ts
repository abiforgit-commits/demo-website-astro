import type { APIRoute } from "astro";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { pool } from "@/lib/db";
import { sendContactEmail } from "@/lib/email";

export const prerender = false;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(190),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  message: z.string().trim().min(10).max(3000),
  token: z.string().min(1),
});

export const POST: APIRoute = async ({ request: req }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }

  const { name, email, phone, message, token } = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // 1. Verify Turnstile
  const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY!,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    }),
  }).then((r) => r.json());

  if (!verify.success) {
    return Response.json({ ok: false, error: "Spam check failed" }, { status: 400 });
  }

  // 2. Save to MySQL
  try {
    await pool.execute(
      "INSERT INTO contact_submissions (name, email, phone, message, ip) VALUES (?, ?, ?, ?, ?)",
      [name, email, phone || null, message, ip]
    );
  } catch (e) {
    console.error("DB insert failed", e);
    return Response.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  // 3. Send email after the response (a failure here never loses the saved row).
  // waitUntil is what Next.js `after()` uses on Vercel.
  waitUntil(
    (async () => {
      try {
        await sendContactEmail({ name, email, phone, message });
      } catch (e) {
        console.error("Email failed", e);
      }
    })()
  );

  return Response.json({ ok: true });
};

// What Next.js answers for other methods on a route that only exports POST:
// OPTIONS → 204 with an Allow header, anything else → 405 with no body.
export const ALL: APIRoute = ({ request }) =>
  request.method === "OPTIONS"
    ? new Response(null, { status: 204, headers: { Allow: "OPTIONS, POST" } })
    : new Response(null, { status: 405 });
