// Side-by-side output comparison: Next.js demo-website vs this Astro copy.
//
//   npm run compare               build both apps, then run every check
//   npm run compare -- --no-build reuse existing builds
//
// Both apps are built with the same test environment, started in production
// mode (Next: `next start`, Astro: the Vercel output via vercel-local.mjs),
// and compared on visuals, DOM/metadata, behaviour, API responses and static
// files. Any difference is reported; the exit code is 1 if anything differs.
import { spawn, execSync } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const astroDir = path.resolve(here, "..");
const nextDir = path.resolve(process.env.NEXT_APP_DIR ?? path.join(astroDir, "../demo-website"));
const outDir = path.join(here, "output");
const args = new Set(process.argv.slice(2));

const SITE_URL = "http://localhost:3000";
// Cloudflare's official Turnstile test keys.
const TURNSTILE_SITE_KEY = "1x00000000000000000000AA"; // always passes, visible
const SECRET_PASS = "1x0000000000000000000000000000000AA";
const SECRET_FAIL = "2x0000000000000000000000000000000AA";

const BUILD_ENV = {
  NEXT_PUBLIC_SITE_URL: SITE_URL,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
  RESEND_API_KEY: "re_dummy_for_compare",
};
const RUNTIME_ENV = {
  ...BUILD_ENV,
  CONTACT_FROM_EMAIL: "from@example.com",
  CONTACT_TO_EMAIL: "to@example.com",
  // No database: point at a closed port so the insert fails fast in both apps.
  DB_HOST: "127.0.0.1",
  DB_PORT: "9",
  DB_USER: "compare",
  DB_PASSWORD: "compare",
  DB_NAME: "compare",
};

const apps = {
  next: {
    name: "next",
    port: 3000,
    cwd: nextDir,
    build: ["node_modules/next/dist/bin/next", "build"],
    start: (port) => ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
  },
  astro: {
    name: "astro",
    port: 4321,
    cwd: astroDir,
    build: ["node_modules/astro/bin/astro.mjs", "build"],
    start: (port) => ["compare/vercel-local.mjs", String(port)],
  },
};

const PAGES = [
  { name: "home", path: "/" },
  { name: "about", path: "/about" },
  { name: "services", path: "/services" },
  { name: "contact", path: "/contact" },
  { name: "404", path: "/does-not-exist" },
];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const results = [];
const metrics = {};
function record(group, name, next, astro, extra = {}) {
  const same = JSON.stringify(next) === JSON.stringify(astro);
  results.push({ group, name, same, ...(same ? {} : { next, astro }), ...extra });
  console.log(`${same ? "  same" : "  DIFF"}  ${group} › ${name}${extra.note ? `  (${extra.note})` : ""}`);
  return same;
}

// ---------------------------------------------------------------- processes

function run(cmd, cwd, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, cmd, { cwd, env: { ...process.env, ...env } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("exit", (code) => resolve({ code, ms: Date.now() - started, output }));
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {}
  } else {
    child.kill("SIGTERM");
  }
}

async function startServer(app, env) {
  const child = spawn(process.execPath, app.start(app.port), {
    cwd: app.cwd,
    env: { ...process.env, ...RUNTIME_ENV, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://localhost:${app.port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(base + "/robots.txt");
      if (res.ok) return { base, child, log: () => log };
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  killTree(child);
  throw new Error(`${app.name} server did not start:\n${log}`);
}

async function withServers(env, fn) {
  const servers = {};
  try {
    servers.next = await startServer(apps.next, env);
    servers.astro = await startServer(apps.astro, env);
    return await fn(servers);
  } finally {
    killTree(servers.next?.child);
    killTree(servers.astro?.child);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function launchBrowser() {
  for (const channel of [undefined, "msedge", "chrome"]) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {}
  }
  throw new Error("No Chromium-based browser available (run `npx playwright install chromium`).");
}

// ---------------------------------------------------------------- builds

async function builds() {
  console.log("\nBuilds");
  const noKeyEnv = { ...BUILD_ENV, RESEND_API_KEY: "" };
  for (const app of Object.values(apps)) {
    const r = await run(app.build, app.cwd, noKeyEnv);
    metrics[app.name] = { buildWithoutResendKey: r.code === 0 ? "succeeds" : "fails" };
  }
  record("build", "build without RESEND_API_KEY", metrics.next.buildWithoutResendKey, metrics.astro.buildWithoutResendKey);
  for (const app of Object.values(apps)) {
    const r = await run(app.build, app.cwd, BUILD_ENV);
    if (r.code !== 0) throw new Error(`${app.name} build failed:\n${r.output}`);
    metrics[app.name].buildMs = r.ms;
    console.log(`  ${app.name} build: ${(r.ms / 1000).toFixed(1)}s`);
  }
}

// ---------------------------------------------------------------- HTTP checks

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function httpSnapshot(base, req) {
  const res = await fetch(base + req.path, {
    method: req.method ?? "GET",
    headers: req.headers,
    body: req.body,
    redirect: "manual",
  });
  const body = Buffer.from(await res.arrayBuffer());
  const snap = { status: res.status };
  if (req.compareHeaders) {
    for (const h of req.compareHeaders) snap[h] = res.headers.get(h);
  }
  if (res.status >= 300 && res.status < 400) snap.location = res.headers.get("location");
  if (req.bodyMode === "text") snap.body = body.toString("utf8");
  if (req.bodyMode === "hash") snap.body = sha(body);
  return snap;
}

const json = (o) => JSON.stringify(o);
const jsonHeaders = { "Content-Type": "application/json" };
const validInput = { name: "Test User", email: "test@example.com", phone: "", message: "Hello from the comparison script", token: "XXXX.DUMMY.TOKEN.XXXX" };
const API = { compareHeaders: ["content-type"], bodyMode: "text" };

async function apiChecks(servers, cases, group) {
  for (const c of cases) {
    const req = { path: "/api/contact", ...API, ...c };
    record(group, c.name, await httpSnapshot(servers.next.base, req), await httpSnapshot(servers.astro.base, req));
  }
}

async function staticChecks(servers) {
  const cases = [
    { name: "GET /robots.txt", path: "/robots.txt", bodyMode: "text" },
    { name: "GET /sitemap.xml", path: "/sitemap.xml", bodyMode: "text" },
    { name: "GET /favicon.ico", path: "/favicon.ico", bodyMode: "hash" },
    { name: "GET /images/placeholder.svg", path: "/images/placeholder.svg", bodyMode: "hash" },
    ...["file", "globe", "next", "vercel", "window"].map((n) => ({ name: `GET /${n}.svg`, path: `/${n}.svg`, bodyMode: "hash" })),
    { name: "GET /og-image.png (missing in both)", path: "/og-image.png" },
    { name: "GET unknown page status", path: "/does-not-exist" },
    { name: "GET /about/ (trailing slash)", path: "/about/" },
    ...PAGES.slice(0, 4).map((p) => ({ name: `GET ${p.path} status`, path: p.path })),
  ];
  for (const c of cases) {
    record("http", c.name, await httpSnapshot(servers.next.base, c), await httpSnapshot(servers.astro.base, c));
  }
}

// ---------------------------------------------------------------- browser helpers

const THIRD_PARTY = /challenges\.cloudflare\.com|google\.com|gstatic\.com|googleapis\.com/;

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Scroll through the page so lazy images start loading, and wait for them
    // before scrolling back (images left far off-screen never load).
    const step = window.innerHeight / 2;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await sleep(100);
    }
    for (let i = 0; i < 100 && [...document.images].some((img) => !img.complete); i++) await sleep(50);
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(250);
}

// Runs in the page: a normalised outline of <head> metadata and the <body> DOM.
// Framework-only nodes (scripts, styles, route announcers, preload links, the
// next/font body classes, data-astro-* attributes) are left out.
function domSnapshot() {
  const frameworkClass = (c) => /^_[\w-]*_variable$|^__variable_|^__className_/.test(c);
  const attrs = (el) =>
    [...el.attributes]
      .filter((a) => !a.name.startsWith("data-astro"))
      .map((a) => {
        let v = a.value;
        if (a.name === "class") v = v.split(/\s+/).filter((c) => c && !frameworkClass(c)).join(" ");
        // Compare the parsed declarations: React sets styles through the CSSOM
        // after client navigation, which reserialises the same CSS differently.
        if (a.name === "style") v = el.style.cssText;
        return [a.name, v];
      })
      .filter(([n, v]) => !(n === "class" && v === ""))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([n, v]) => `${n}="${v}"`)
      .join(" ");

  const skip = (el) =>
    ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NEXT-ROUTE-ANNOUNCER"].includes(el.tagName) ||
    el.classList.contains("astro-route-announcer") ||
    // React's streaming placeholder: <div hidden><!--$--><!--/$--></div> under <body>.
    (el.parentElement === document.body && el.tagName === "DIV" && el.hidden && !el.children.length && !el.textContent.trim()) ||
    // Previously visited routes Next.js keeps alive but hidden (not rendered output).
    el.style.display === "none";

  const lines = [`<body ${attrs(document.body)}>`];
  const walk = (node, depth) => {
    let text = "";
    const flush = () => {
      const t = text.replace(/\s+/g, " ").trim();
      if (t) lines.push(`${"  ".repeat(depth)}"${t}"`);
      text = "";
    };
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if (skip(child)) continue;
        flush();
        const a = attrs(child);
        lines.push(`${"  ".repeat(depth)}<${child.tagName.toLowerCase()}${a ? " " + a : ""}>`);
        if (child.id !== "cf-turnstile") walk(child, depth + 1); // third-party widget contents
      }
    }
    flush();
  };
  walk(document.body, 1);

  const icon = document.querySelector('link[rel="icon"]');
  const head = {
    lang: document.documentElement.lang,
    charset: document.characterSet,
    title: document.title,
    meta: [...document.head.querySelectorAll("meta[name], meta[property]")]
      .map((m) => `${m.getAttribute("name") ?? m.getAttribute("property")}=${m.getAttribute("content")}`)
      .filter((s) => !/^(next-|astro-)/.test(s))
      .sort(),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    icon: icon && {
      href: icon.getAttribute("href").split("?")[0],
      sizes: icon.getAttribute("sizes"),
      type: icon.getAttribute("type"),
    },
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
  };
  return { head, body: lines };
}

function firstDiffs(a, b, max = 8) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < max; i++) {
    if (a[i] !== b[i]) out.push({ line: i + 1, next: a[i] ?? "(none)", astro: b[i] ?? "(none)" });
  }
  return out;
}

// ---------------------------------------------------------------- page checks

async function pageChecks(browser, servers) {
  await mkdir(path.join(outDir, "visual"), { recursive: true });

  for (const vp of VIEWPORTS) {
    for (const pg of PAGES) {
      const shots = {};
      const doms = {};
      for (const name of ["next", "astro"]) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        await page.route(THIRD_PARTY, (r) => r.abort());
        await page.goto(servers[name].base + pg.path, { waitUntil: "load" });
        await settle(page);
        doms[name] = await page.evaluate(domSnapshot);
        shots[name] = PNG.sync.read(
          await page.screenshot({
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            mask: [page.locator("iframe")],
          })
        );
        await writeFile(path.join(outDir, "visual", `${pg.name}-${vp.name}-${name}.png`), PNG.sync.write(shots[name]));
        await context.close();
      }

      const label = `${pg.path} @ ${vp.name}`;
      if (vp.name === "desktop") {
        record("head", label, doms.next.head, doms.astro.head);
        const same = doms.next.body.join("\n") === doms.astro.body.join("\n");
        results.push({ group: "dom", name: label, same, ...(same ? {} : { diffs: firstDiffs(doms.next.body, doms.astro.body) }) });
        console.log(`${same ? "  same" : "  DIFF"}  dom › ${label}`);
        if (!same) console.log(firstDiffs(doms.next.body, doms.astro.body, 4));
      }

      const { next: a, astro: b } = shots;
      if (a.width !== b.width || a.height !== b.height) {
        record("visual", label, { width: a.width, height: a.height }, { width: b.width, height: b.height }, { note: "page size differs" });
        continue;
      }
      const diff = new PNG({ width: a.width, height: a.height });
      const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0 });
      if (diffPixels) await writeFile(path.join(outDir, "visual", `${pg.name}-${vp.name}-diff.png`), PNG.sync.write(diff));
      record("visual", label, 0, diffPixels, { note: `${a.width}x${a.height}px, differing pixels: ${diffPixels}` });
    }
  }
}

// ---------------------------------------------------------------- behaviour

async function behaviour(browser, base, { blockTurnstile }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.route(/google\.com|gstatic\.com|googleapis\.com/, (r) => r.abort());
  if (blockTurnstile) await page.route(/challenges\.cloudflare\.com/, (r) => r.abort());
  const log = [];
  const state = (label) =>
    page.evaluate((label) => {
      const btn = document.querySelector('button[aria-controls="mobile-menu"]');
      const menu = document.getElementById("mobile-menu");
      return {
        label,
        path: location.pathname + location.hash,
        title: document.title,
        sameDocument: window.__compareMarker === "kept",
        header: document.querySelector("header")?.className,
        footer: document.querySelector("footer")?.className,
        menuHidden: menu?.hidden,
        ariaExpanded: btn?.getAttribute("aria-expanded"),
        ariaLabel: btn?.getAttribute("aria-label"),
        icon: btn?.querySelector("path")?.getAttribute("d"),
        current: [...document.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent.trim()),
      };
    }, label);
  const menuButton = page.locator('button[aria-controls="mobile-menu"]');

  await page.goto(base + "/", { waitUntil: "load" });
  await page.evaluate(() => (window.__compareMarker = "kept"));
  log.push(await state("home loaded"));
  await menuButton.click();
  log.push(await state("menu opened"));
  await menuButton.click();
  log.push(await state("menu closed"));
  await menuButton.click();
  await page.locator("#mobile-menu a", { hasText: "About" }).click();
  await page.waitForURL("**/about");
  await page.waitForTimeout(500);
  log.push(await state("navigated to /about via mobile menu"));

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.locator('a[aria-label="Back to top"]').click();
  await page.waitForTimeout(1500);
  log.push({ ...(await state("back to top clicked")), scrolledToTop: await page.evaluate(() => window.scrollY === 0) });

  await menuButton.click();
  await page.locator("#mobile-menu a", { hasText: "Contact Us" }).click();
  await page.waitForURL("**/contact");
  await page.waitForTimeout(500);
  log.push(await state("navigated to /contact via mobile menu"));

  // Same DOM after client-side navigation as on a direct load.
  log.push({ label: "contact DOM after client navigation", dom: (await page.evaluate(domSnapshot)).body });

  const form = page.locator("form");
  await form.locator("#name").fill("Test User");
  await form.locator("#email").fill("test@example.com");
  await form.locator("#message").fill("Hello from the comparison script");
  const formState = (label) =>
    page.evaluate((label) => {
      const alert = document.querySelector('p[role="alert"]');
      const status = document.querySelector('p[role="status"]');
      const button = document.querySelector('form button[type="submit"]');
      return {
        label,
        formPresent: !!document.querySelector("form"),
        alert: alert ? { text: alert.textContent, class: alert.className } : null,
        status: status ? { text: status.textContent, class: status.className } : null,
        button: button ? { text: button.textContent, disabled: button.disabled } : null,
      };
    }, label);

  if (blockTurnstile) {
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(300);
    log.push(await formState("submit without spam-check token"));
  } else {
    await page.waitForFunction(() => document.querySelector('#cf-turnstile input[name="cf-turnstile-response"]')?.value, null, { timeout: 30000 });
    await form.locator('button[type="submit"]').click();
    await page.waitForResponse("**/api/contact");
    await page.waitForTimeout(300);
    log.push(await formState("submit with token, no database (real API)"));

    await page.route("**/api/contact", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(500);
    log.push(await formState("submit with token, API mocked to succeed"));
    log.push({ label: "turnstile widgets left in page", count: await page.locator("#cf-turnstile").count() });
  }

  await context.close();
  return log;
}

// Next.js keeps the 3 most recently visited routes alive, so the contact form
// keeps what was typed (and its error message) when the visitor comes back.
async function formMemory(browser, base, route, { useBackButton = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route(THIRD_PARTY, (r) => r.abort());
  await page.goto(base + "/contact", { waitUntil: "load" });
  await page.waitForTimeout(500);
  await page.fill("#name", "Typed Name");
  await page.click('form button[type="submit"]'); // no token → "complete the spam check"
  await page.waitForTimeout(300);
  const go = async (p) => {
    await page.click(`header nav[aria-label="Main"] a[href="${p}"]`);
    await page.waitForURL((u) => new URL(u).pathname === p);
    await page.waitForTimeout(500);
  };
  for (const p of route) await go(p);
  if (useBackButton) {
    await page.goBack();
    await page.waitForURL((u) => new URL(u).pathname === "/contact");
    await page.waitForTimeout(500);
  } else {
    await go("/contact");
  }
  const state = await page.evaluate(() => ({
    name: document.querySelector("form #name")?.value ?? null,
    alert: document.querySelector('form p[role="alert"]')?.textContent ?? null,
  }));
  await context.close();
  return state;
}

async function formMemoryChecks(browser, servers) {
  const trials = [
    { route: ["/about"] },
    { route: ["/about"], useBackButton: true },
    { route: ["/about", "/services"] },
    { route: ["/about", "/services", "/about"] },
    { route: ["/about", "/services", "/"] },
    { route: ["/about", "/services", "/about", "/services"] },
  ];
  for (const t of trials) {
    const label = ["/contact", ...t.route, t.useBackButton ? "back button" : "/contact"].join(" → ");
    record("form memory", label, await formMemory(browser, servers.next.base, t.route, t), await formMemory(browser, servers.astro.base, t.route, t));
  }
}

async function behaviourChecks(browser, servers) {
  await formMemoryChecks(browser, servers);
  for (const blockTurnstile of [true, false]) {
    const group = blockTurnstile ? "behaviour (spam check blocked)" : "behaviour (spam check passes)";
    const logs = {};
    for (const name of ["next", "astro"]) logs[name] = await behaviour(browser, servers[name].base, { blockTurnstile });
    for (let i = 0; i < Math.max(logs.next.length, logs.astro.length); i++) {
      const { label, ...a } = logs.next[i] ?? {};
      const { label: _, ...b } = logs.astro[i] ?? {};
      if (a.dom) {
        const same = a.dom.join("\n") === b.dom.join("\n");
        results.push({ group, name: label, same, ...(same ? {} : { diffs: firstDiffs(a.dom, b.dom) }) });
        console.log(`${same ? "  same" : "  DIFF"}  ${group} › ${label}`);
      } else {
        record(group, label ?? `step ${i + 1}`, a, b);
      }
    }
  }
}

// ---------------------------------------------------------------- metrics

async function pageMetrics(browser, base, pagePath) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route(THIRD_PARTY, (r) => r.abort());
  const responses = [];
  let loaded = false;
  page.on("response", async (res) => {
    const atLoad = !loaded;
    try {
      const body = await res.body();
      responses.push({ url: res.url(), type: res.request().resourceType(), bytes: body.length, gzip: gzipSync(body).length, atLoad });
    } catch {}
  });
  await page.goto(base + pagePath, { waitUntil: "load" });
  loaded = true;
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  await context.close();

  const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
  const byType = (list, types) => list.filter((r) => types.includes(r.type));
  const initial = responses.filter((r) => r.atLoad);
  const later = responses.filter((r) => !r.atLoad);
  return {
    requestsAtLoad: initial.length,
    htmlBytes: sum(byType(initial, ["document"]), "bytes"),
    jsBytes: sum(byType(initial, ["script"]), "bytes"),
    jsGzip: sum(byType(initial, ["script"]), "gzip"),
    cssBytes: sum(byType(initial, ["stylesheet"]), "bytes"),
    fontBytes: sum(byType(initial, ["font"]), "bytes"),
    totalBytesAtLoad: sum(initial, "bytes"),
    totalGzipAtLoad: sum(initial, "gzip"),
    prefetchRequestsAfterLoad: later.length,
    prefetchBytesAfterLoad: sum(later, "bytes"),
  };
}

async function metricChecks(browser, servers) {
  for (const name of ["next", "astro"]) {
    metrics[name].pages = {};
    for (const pg of PAGES.slice(0, 4)) {
      metrics[name].pages[pg.path] = await pageMetrics(browser, servers[name].base, pg.path);
    }
  }
}

// ---------------------------------------------------------------- main

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  console.log(`Next.js app: ${nextDir}\nAstro app:   ${astroDir}`);

  if (!args.has("--no-build")) await builds();
  for (const app of Object.values(apps)) metrics[app.name] ??= {};

  console.log("\nAPI with a failing spam-check secret");
  await withServers({ TURNSTILE_SECRET_KEY: SECRET_FAIL }, (servers) =>
    apiChecks(servers, [
      { name: "POST invalid JSON", method: "POST", headers: jsonHeaders, body: "not json" },
      { name: "POST empty object", method: "POST", headers: jsonHeaders, body: "{}" },
      { name: "POST invalid email", method: "POST", headers: jsonHeaders, body: json({ ...validInput, email: "nope" }) },
      { name: "POST message too short", method: "POST", headers: jsonHeaders, body: json({ ...validInput, message: "short" }) },
      { name: "POST name too short", method: "POST", headers: jsonHeaders, body: json({ ...validInput, name: "A" }) },
      { name: "POST missing token", method: "POST", headers: jsonHeaders, body: json({ ...validInput, token: "" }) },
      { name: "POST phone too long", method: "POST", headers: jsonHeaders, body: json({ ...validInput, phone: "1".repeat(31) }) },
      { name: "POST valid input, spam check fails", method: "POST", headers: jsonHeaders, body: json(validInput) },
      { name: "POST cross-site text/plain", method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://other.example" }, body: "hello" },
      { name: "POST cross-site form data", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://other.example" }, body: "name=x" },
    ], "api")
  );

  console.log("\nEverything else with a passing spam-check secret");
  const browser = await launchBrowser();
  try {
    await withServers({ TURNSTILE_SECRET_KEY: SECRET_PASS }, async (servers) => {
      await apiChecks(servers, [
        { name: "POST valid input, no database", method: "POST", headers: jsonHeaders, body: json(validInput) },
        { name: "POST valid input with phone, no database", method: "POST", headers: jsonHeaders, body: json({ ...validInput, phone: "+91 98765 43210" }) },
        { name: "GET", method: "GET" },
        { name: "HEAD", method: "HEAD" },
        { name: "PUT", method: "PUT", headers: jsonHeaders, body: "{}" },
        { name: "PATCH", method: "PATCH", headers: jsonHeaders, body: "{}" },
        { name: "DELETE", method: "DELETE" },
        { name: "OPTIONS", method: "OPTIONS", compareHeaders: ["content-type", "allow"] },
      ], "api");
      console.log("\nStatic files and status codes");
      await staticChecks(servers);
      console.log("\nPages: metadata, DOM, pixels");
      await pageChecks(browser, servers);
      console.log("\nBehaviour");
      await behaviourChecks(browser, servers);
      console.log("\nMetrics");
      await metricChecks(browser, servers);
    });
  } finally {
    await browser.close();
  }

  const differing = results.filter((r) => !r.same);
  await writeFile(path.join(outDir, "report.json"), JSON.stringify({ results, metrics }, null, 2));
  console.log(`\n${results.length - differing.length}/${results.length} checks identical.`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  console.log(JSON.stringify(metrics, null, 2));
  process.exitCode = differing.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
