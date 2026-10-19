import { chromium } from "playwright";
import { createRequire } from "module";
const { toJSON } = createRequire(import.meta.url)("seroval");
const S = process.argv[2];
const enc = (v) => JSON.stringify(toJSON({ result: v, context: {} }).t);
const H = { "content-type": "application/json", "x-tss-serialized": "true" };
const UID = "11111111-2222-3333-4444-555555555555";
const user = { id: UID, aud: "authenticated", role: "authenticated", email: "t@example.com", is_anonymous: false, user_metadata: {}, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const session = { access_token: "x.y.z", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await ctx.addInitScript((s) => localStorage.setItem("sb-khjoyiqxupykicqnvhlc-auth-token", JSON.stringify(s)), session);
await ctx.route("**/__l5e/**", (r) => r.fulfill({ status: 404 }));
await ctx.route("**/khjoyiqxupykicqnvhlc.supabase.co/**", (r) => {
  const u = r.request().url();
  const single = (r.request().headers()["accept"] || "").includes("vnd.pgrst.object");
  if (u.includes("/auth/v1/user")) return r.fulfill({ json: user });
  if (u.includes("/rest/v1/profiles")) {
    const p = { id: UID, email: "t@example.com", display_name: "Imran", coin_balance: 30, referral_code: "ABC123", artist_bio: "London MC", created_at: "2026-01-01T00:00:00Z" };
    return r.fulfill({ json: single ? p : [p] });
  }
  if (u.includes("/rest/v1/user_preferences")) { const pr = { messenger_mode: "loner", foul_mouth: true }; return r.fulfill({ json: single ? pr : [pr] }); }
  if (u.includes("/rest/v1/user_roles")) return r.fulfill({ json: process.env.ROLES==="boss"?[{ role: "user" }, { role: "boss" }]:[{ role: "user" }] });
  if (u.includes("/rest/v1/rpc/has_role")) return r.fulfill({ json: false });
  if (u.includes("/rest/v1/coin_transactions")) return r.fulfill({ json: [{id:"1",amount:20,type:"welcome",reference:null,created_at:"2026-10-01T10:00:00Z"},{id:"2",amount:-5,type:"unlock",reference:"unlock:x",created_at:"2026-10-02T10:00:00Z"}] });
  if (u.includes("/realtime/")) return r.abort();
  return r.fulfill({ json: single ? null : [] });
});
await ctx.route("**/_serverFn/**", async (r) => {
  const dec = Buffer.from(r.request().url().split("_serverFn/")[1].split("?")[0], "base64").toString();
  if (dec.includes("chatOgBot")) {
    await new Promise((res) => setTimeout(res, 3000));
    return r.fulfill({ headers: H, body: enc({ reply: "📊 XAU/USD — BUY (test reply)", coin_balance: 30, learned_insults: [], ambush: false }) });
  }
  if (dec.includes("listMyMemories")) return r.fulfill({ headers: H, body: enc({ enabled: true, memories: [{id:"11111111-1111-1111-1111-111111111111",fact:"Supports Spurs",created_at:""},{id:"21111111-1111-1111-1111-111111111111",fact:"Rap name is Lil Bricks",created_at:""},{id:"31111111-1111-1111-1111-111111111111",fact:"Dan is the mate they always roast",created_at:""}] }) });
  if (dec.includes("getVipPassStatus")) return r.fulfill({ headers: H, body: enc(process.env.VAULT==="no" ? { owned:false, username:null, password:null } : { owned: true, purchased: true, username: "ogvault7", password: "K9-PX-22", available: 3 }) });
  return r.fulfill({ headers: H, body: enc(null) });
});
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 150)));
const scan = () => p.evaluate(() => {
  const bad = [];
  const toHsl = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; let [r,g,b] = m.slice(0,3).map(Number); if (c.startsWith("oklch")||c.startsWith("lab")) return null; r/=255; g/=255; b/=255; const mx=Math.max(r,g,b), mn=Math.min(r,g,b); const l=(mx+mn)/2; if (mx===mn) return {h:0,s:0,l}; const d=mx-mn; const s=l>0.5?d/(2-mx-mn):d/(mx+mn); let h = mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4; return {h:h*60,s,l}; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || !el.offsetParent) continue; const c = getComputedStyle(el).color; const hsl = toHsl(c); if (hsl && hsl.s > 0.25 && hsl.h >= 180 && hsl.h <= 305 && hsl.l > 0.15) bad.push(t.slice(0,40)+" => "+c); }
  return bad;
});
const path = process.argv[2] || "/settings";
await p.goto("http://127.0.0.1:5199" + path, { waitUntil: "networkidle" }).catch(() => {});
await p.waitForTimeout(3500);
if (await p.getByText("Remind me later").count()) { await p.getByText("Remind me later").click(); await p.waitForTimeout(400); }
console.log("url:", p.url());
if (path === "/settings") {
  const rev = p.getByRole("button", { name: /Reveal Vault/ });
  if (await rev.count()) { await rev.click(); await p.waitForTimeout(800); }
}
console.log("overflow px:", await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
console.log("headings:", (await p.locator("main h1, main h2").allTextContents()).join(" | "));
console.log("blue text:", JSON.stringify(await scan()));
const card = p.getByRole("heading", { name: "OG Bot's memory" });
await card.scrollIntoViewIfNeeded();
await p.screenshot({ path: "/tmp/claude-0/-home-user-og-196/93e79a27-2a9e-5959-b340-8a0e28636847/scratchpad/memory-card.png" });
await p.screenshot({ path: "/tmp/claude-0/-home-user-og-196/93e79a27-2a9e-5959-b340-8a0e28636847/scratchpad/settings-" + (process.env.ROLES||"member") + (process.env.VAULT||"") + ".png", fullPage: true });
await b.close();
