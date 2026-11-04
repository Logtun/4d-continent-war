// 4D Continent War backend. Community-built by @iamlogtun. Not affiliated with 4D Labs.
// Data sources (all public, read-only):
//  1) Season SNAPS per continent: 4D Labs' own public dApp API  https://dapp.4dlabs.space/api/task/checkin-stat-by-season?season_phase=S1
//     (the same numbers the dApp shows as "Snaps N" on each landmark card).
//  2) Today's check-ins per continent: CheckIn events of the 4D Labs check-in contract on BNB Chain
//     (0x654612a216517bdbbA8356Ff9462944AC5165fDc, address from the dApp's /api/task/task-config), read through a public BSC RPC,
//     bucketed by block timestamp into UTC days. Scan progress is kept in R2 so each request only reads new blocks.
//  3) Official posts: @4Dlabs_Official timeline via api.fxtwitter.com, filtered to region posts.
//  4) Share cards: PNGs drawn in the browser, stored in R2, served at /s/<id>.
const DAPP = "https://dapp.4dlabs.space";
const CONTRACT = "0x654612a216517bdbbA8356Ff9462944AC5165fDc";
const TOPIC = "0x1a7911c2ec7ba5690ebeb30ff17ce88e238bf50470f0ad819aead3f03d6735f3";
const RPCS = ["https://bsc-rpc.publicnode.com", "https://rpc-bsc.48.club", "https://bsc.rpc.blxrbdn.com"];
const SEED_BLOCK = 131525097;          // first block of 2026-11-04 00:00 UTC (found by binary search on block timestamps)
const SEED_DAY = "2026-11-04";
const CHUNK = 1500;
const CONT = ["AFR", "ASN", "EUR", "NAM", "OCE", "SAM"];
const ORIGIN = "https://4d-continent-war.sites.tab.bot";

const J = (o, s = 200, maxAge = 0) => new Response(JSON.stringify(o), { status: s, headers: {
  "content-type": "application/json; charset=utf-8", "cache-control": maxAge ? "public, max-age=" + maxAge : "no-store",
  "access-control-allow-origin": "*" } });
const mem = new Map();
const memGet = (k, ms) => { const h = mem.get(k); return h && Date.now() - h.t < ms ? h.v : null; };
const memSet = (k, v) => { mem.set(k, { t: Date.now(), v }); return v; };
const dayOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

async function r2json(env, key) { try { const o = await env.FILES.get(key); return o ? await o.json() : null; } catch { return null; } }
async function r2put(env, key, v) { await env.FILES.put(key, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } }); }

// ---------- 1) season SNAPS from the 4D Labs dApp API ----------
async function season(env) {
  const hit = memGet("season", 45000); if (hit) return hit;
  let items = null, err = null;
  for (const path of ["/api/task/checkin-stat-by-season?season_phase=S1", "/api/task/checkin-stat"]) {
    try {
      const r = await fetch(DAPP + path, { headers: { accept: "application/json", "user-agent": "4d-continent-war (community board)" }, cf: { cacheTtl: 30 } });
      if (!r.ok) { err = "HTTP " + r.status; continue; }
      const j = await r.json();
      if (Array.isArray(j.items) && j.items.length) { items = j.items; break; }
    } catch (e) { err = String(e && e.message || e); }
  }
  if (!items) {
    const last = await r2json(env, "season/last.json");
    if (last) return { ...last, stale: true, error: err };
    throw new Error("season source unavailable: " + err);
  }
  const counts = {}; for (const c of CONT) counts[c] = 0;
  for (const it of items) if (CONT.includes(it.continent)) counts[it.continent] = Number(it.count) || 0;
  const out = { source: DAPP + "/api/task/checkin-stat-by-season?season_phase=S1", fetchedAt: Date.now(), counts };
  // hourly snapshot for the "last hour" trend (one object per UTC hour, first writer wins)
  try {
    const hr = new Date().toISOString().slice(0, 13);
    const key = "snap/" + hr + ".json";
    if (!memGet("snapw:" + hr, 3600000)) {
      if (!(await env.FILES.head(key))) await r2put(env, key, out);
      memSet("snapw:" + hr, 1);
    }
    if (!memGet("lastw", 300000)) { await r2put(env, "season/last.json", out); memSet("lastw", 1); }
  } catch {}
  return memSet("season", out);
}
async function trend(env, now) {
  const hit = memGet("trend", 120000); if (hit) return hit;
  const t = Date.now(), res = {};
  for (const [label, h] of [["h1", 1], ["h24", 24]]) {
    const key = "snap/" + new Date(t - h * 3600000).toISOString().slice(0, 13) + ".json";
    const s = await r2json(env, key);
    if (s && s.counts) {
      const d = {}; for (const c of CONT) d[c] = (now.counts[c] || 0) - (s.counts[c] || 0);
      res[label] = { since: s.fetchedAt, delta: d };
    }
  }
  return memSet("trend", res);
}

// ---------- 2) today's on-chain check-ins ----------
async function rpc(method, params) {
  const errs = [];
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "user-agent": "Mozilla/5.0 (4d-continent-war community board)" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(9000) });
      const txt = await r.text(); let j;
      try { j = JSON.parse(txt); } catch { errs.push(url.split("/")[2] + ": HTTP " + r.status + " " + txt.slice(0, 80)); continue; }
      if (j.result !== undefined && j.result !== null) return j.result;
      errs.push(url.split("/")[2] + ": " + ((j.error && j.error.message) || "no result"));
    } catch (e) { errs.push(url.split("/")[2] + ": " + String(e && e.message || e)); }
  }
  throw new Error(errs.join(" | "));
}
function decodeLoc(data) {
  try { const h = data.slice(2); const off = parseInt(h.slice(0, 64), 16) * 2; const n = parseInt(h.slice(off, off + 64), 16);
    let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(parseInt(h.slice(off + 64 + i * 2, off + 66 + i * 2), 16)); return s; } catch { return ""; }
}
const SEED_STATE = {"lastBlock": 131562746, "days": {"2026-11-04": {"AFR": 1781, "ASN": 4556, "EUR": 1057, "NAM": 1914, "OCE": 601, "SAM": 533}}, "partial": {}, "startedDay": "2026-11-04", "lastTs": 1793767335, "updatedAt": 0, "seededFrom": "box backfill from block 131525097"};   // today's counts backfilled from BNB Chain (same contract, same event) when the board launched
let scanning = null;
async function loadState(env) {
  let st = memGet("chainst", 15000);
  if (!st) { st = await r2json(env, "chain/state.json"); if (!st || !st.lastBlock || st.lastBlock < SEED_STATE.lastBlock) st = JSON.parse(JSON.stringify(SEED_STATE)); memSet("chainst", st); }
  return st;
}
async function scan(env) {
  const t0 = Date.now();
  const st = JSON.parse(JSON.stringify(await loadState(env)));
  const head = parseInt(await rpc("eth_blockNumber", []), 16);
  let from = st.lastBlock + 1, lastTs = st.lastTs || 0;
  while (from <= head && Date.now() - t0 < 20000) {
    const to = Math.min(from + CHUNK - 1, head);
    let logs;
    try { logs = await rpc("eth_getLogs", [{ address: CONTRACT, topics: [TOPIC], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) }]); }
    catch (e) {
      if (/archive|pruned|missing trie/i.test(String(e.message))) {   // fell too far behind: skip ahead, mark days partial
        st.partial[dayOf(Math.floor(Date.now() / 1000))] = true; if (lastTs) st.partial[dayOf(lastTs)] = true;
        from = Math.max(from + 1, head - CHUNK * 4); st.lastBlock = from - 1; continue;
      }
      st.lastError = String(e.message).slice(0, 300); break;
    }
    for (const l of logs) {
      const ts = parseInt(l.blockTimestamp, 16); const loc = decodeLoc(l.data);
      if (!ts || !CONT.includes(loc)) continue;
      const d = dayOf(ts); const row = st.days[d] || (st.days[d] = { AFR: 0, ASN: 0, EUR: 0, NAM: 0, OCE: 0, SAM: 0 });
      row[loc]++; lastTs = Math.max(lastTs, ts);
    }
    st.lastBlock = to; from = to + 1; delete st.lastError;
  }
  const keys = Object.keys(st.days).sort(); while (keys.length > 21) delete st.days[keys.shift()];
  st.lastTs = lastTs; st.head = head; st.updatedAt = Date.now(); st.behind = head - st.lastBlock;
  const cur = await r2json(env, "chain/state.json");          // never move backwards if another isolate got further
  if (!cur || !cur.lastBlock || cur.lastBlock <= st.lastBlock) await r2put(env, "chain/state.json", st);
  memSet("chainst", st);
  return st;
}
function kickScan(env, ctx) {
  if (scanning || memGet("scanKick", 25000)) return;
  memSet("scanKick", 1);
  scanning = scan(env).catch((e) => { memSet("scanErr", String(e && e.message || e)); }).finally(() => { scanning = null; });
  if (ctx && ctx.waitUntil) ctx.waitUntil(scanning);
}
async function chain(env, ctx) { const st = await loadState(env); kickScan(env, ctx); return st; }

async function standings(env, ctx) {
  const [s, c] = await Promise.allSettled([season(env), chain(env, ctx)]);
  const out = { now: Date.now(), contract: CONTRACT };
  if (s.status === "fulfilled") { out.season = s.value; out.trend = await trend(env, s.value).catch(() => ({})); }
  else out.seasonError = String(s.reason && s.reason.message || s.reason);
  if (c.status === "fulfilled") {
    const st = c.value, today = new Date().toISOString().slice(0, 10);
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    out.chain = { today, todayCounts: st.days[today] || { AFR: 0, ASN: 0, EUR: 0, NAM: 0, OCE: 0, SAM: 0 },
      yesterday: y, yesterdayCounts: (st.days[y] && y >= st.startedDay && !st.partial[y]) ? st.days[y] : null,
      days: Object.fromEntries(Object.entries(st.days).filter(([d]) => d >= st.startedDay && !st.partial[d])),
      partialToday: !!st.partial[today], scannedTo: st.lastBlock, head: st.head, behind: st.behind, lastEventTs: st.lastTs, trackingSince: st.startedDay, scanUpdatedAt: st.updatedAt, scanNote: st.lastError || memGet("scanErr", 600000) || null };
  } else out.chainError = String(c.reason && c.reason.message || c.reason);
  return out;
}

// ---------- 3) official region posts ----------
async function official(env) {
  const hit = memGet("official", 900000); if (hit) return hit;
  try {
    const r = await fetch("https://api.fxtwitter.com/2/profile/4Dlabs_Official/statuses", { headers: { "user-agent": "Mozilla/5.0 (4d-continent-war)" } });
    const j = await r.json();
    const posts = (j.results || []).filter((p) => /check-?in pick|leads all six regions|landmark spotlight|SNAPS|continent/i.test(p.text || ""))
      .map((p) => ({ url: p.url, text: p.text, created_at: p.created_at, ts: Date.parse(p.created_at) || 0 }))
      .sort((a, b) => b.ts - a.ts).slice(0, 8);
    if (!posts.length && !(j.results || []).length) throw new Error("empty timeline");
    const out = { source: "x.com/4Dlabs_Official (via api.fxtwitter.com)", fetchedAt: Date.now(), posts };
    try { await r2put(env, "official/last.json", out); } catch {}
    return memSet("official", out);
  } catch (e) {
    const last = await r2json(env, "official/last.json");
    if (last) return memSet("official", { ...last, stale: true });
    return { fetchedAt: Date.now(), posts: [], error: String(e.message || e) };
  }
}

// ---------- 4) share cards ----------
const CARD_MAX = 1536 * 1024, CARD_W = 1200, CARD_H = 675, CARD_RATE = 30;
const ID_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const NAMES = { AFR: "Africa", ASN: "Asia", EUR: "Europe", NAM: "North America", OCE: "Oceania", SAM: "South America" };
function newId(n = 9) { const b = new Uint8Array(n); crypto.getRandomValues(b); let s = ""; for (const x of b) s += ID_ABC[x % ID_ABC.length]; return s; }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function noteGet(env, k) { const o = await env.FILES.get("n/" + k); return o ? await o.text() : null; }
async function notePut(env, k, v) { await env.FILES.put("n/" + k, String(v)); }
async function cardUpload(req, env, url) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > CARD_MAX) return J({ error: "too_large" }, 413);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > CARD_MAX) return J({ error: "too_large" }, 413);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 33 || SIG.some((v, i) => buf[i] !== v)) return J({ error: "not_png" }, 415);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(16) !== CARD_W || dv.getUint32(20) !== CARD_H) return J({ error: "bad_dimensions" }, 422);
  const c = (url.searchParams.get("c") || "").toUpperCase(); const cont = CONT.includes(c) ? c : "";
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const known = await noteGet(env, "h/" + hash);
  if (known) return J({ id: known, url: ORIGIN + "/s/" + known, dedupe: true });
  const ip = req.headers.get("cf-connecting-ip") || "unknown", hr = Math.floor(Date.now() / 3600000);
  const rk = "rl/" + hr + "/" + ip.replace(/[^0-9a-fA-F:.]/g, "_");
  const used = Number(await noteGet(env, rk) || 0);
  if (used >= CARD_RATE) return J({ error: "rate_limited" }, 429);
  await notePut(env, rk, used + 1);
  let id = newId(); if (await env.FILES.head("cards/" + id + ".png")) id = newId(10);
  await env.FILES.put("cards/" + id + ".png", buf, { httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { c: cont, created: new Date().toISOString() } });
  await notePut(env, "h/" + hash, id);
  return J({ id, url: ORIGIN + "/s/" + id });
}
async function cardServe(req, env, url) {
  const m = url.pathname.match(/^\/s\/([A-Za-z0-9]{8,10})(\.png)?$/);
  const home = new Response(null, { status: 302, headers: { location: "/", "cache-control": "no-store" } });
  if (!m) return home;
  const id = m[1];
  if (m[2]) {
    const obj = await env.FILES.get("cards/" + id + ".png");
    if (!obj) return new Response("not found", { status: 404 });
    return new Response(req.method === "HEAD" ? null : obj.body, { headers: { "content-type": "image/png", "content-length": String(obj.size),
      "cache-control": "public, max-age=31536000, immutable", etag: obj.httpEtag } });
  }
  const head = await env.FILES.head("cards/" + id + ".png");
  if (!head) return home;
  const c = (head.customMetadata || {}).c; const name = NAMES[c];
  const title = name ? "I checked in for " + name + " on 4D Labs S1" : "Continent War: 4D Labs S1 check-ins";
  const desc = "Live check-in standings for the six continents in 4D Labs Season 1. Pick your side and check in daily on BNB Chain.";
  const img = ORIGIN + "/s/" + id + ".png", page = ORIGIN + "/s/" + id, dest = ORIGIN + "/" + (c ? "?c=" + c : "");
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + esc(title) + "</title><meta name=\"description\" content=\"" + esc(desc) + "\">" +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Continent War">' +
    '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
    '<meta property="og:url" content="' + page + '"><meta property="og:image" content="' + img + '">' +
    '<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(title) + '">' +
    '<meta name="twitter:description" content="' + esc(desc) + '"><meta name="twitter:image" content="' + img + '">' +
    '<meta http-equiv="refresh" content="0;url=' + esc(dest) + '">' +
    '<style>body{background:#0E0F14;color:#F2F2F3;font:16px system-ui,sans-serif;text-align:center;padding:40px 16px}a{color:#7BB8FF}</style>' +
    '</head><body><p>Opening Continent War… <a href="' + esc(dest) + '">Continue</a></p><script>location.replace(' + JSON.stringify(dest) + ');</script></body></html>';
  return new Response(req.method === "HEAD" ? null : html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/standings") return J(await standings(env, ctx), 200, 15);
      if (url.pathname === "/api/official") return J(await official(env), 200, 600);
      if (url.pathname === "/api/card" && req.method === "POST") return await cardUpload(req, env, url);
      if (url.pathname.startsWith("/s/")) return await cardServe(req, env, url);
    } catch (e) {
      return J({ error: String(e && e.message || e) }, 502);
    }
    return env.ASSETS.fetch(req);
  },
};
