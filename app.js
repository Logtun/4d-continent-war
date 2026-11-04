"use strict";
(() => {
const ORDER = ["AFR", "ASN", "EUR", "NAM", "OCE", "SAM"];
const NAME = { AFR: "Africa", ASN: "Asia", EUR: "Europe", NAM: "North America", OCE: "Oceania", SAM: "South America" };
const LANDMARK = { AFR: "Pyramid", ASN: "Great Wall", EUR: "Eiffel", NAM: "Liberty", OCE: "Opera", SAM: "Christ" };
const DOMAIN = "4d-continent-war.vercel.app";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let data = null;
let pick = (new URLSearchParams(location.search).get("c") || "AFR").toUpperCase();
if (!ORDER.includes(pick)) pick = "AFR";

function ranked(counts) { return ORDER.map((c) => ({ c, n: Number(counts[c] || 0) })).sort((a, b) => b.n - a.n); }
function ago(ms) { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + "s ago" : Math.round(s / 60) + " min ago"; }

function renderRows(ol, counts, extra) {
  const r = ranked(counts), max = Math.max(1, r[0].n), total = r.reduce((a, b) => a + b.n, 0) || 1;
  ol.innerHTML = "";
  r.forEach((x, i) => {
    const li = el("li", "row" + (i === 0 ? " first" : "") + (x.c === "AFR" ? " afr" : ""));
    const pct = Math.round((x.n / total) * 1000) / 10;
    const ex = extra ? extra(x.c) : "";
    li.innerHTML = '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="nm">' + NAME[x.c] + '<small>' + LANDMARK[x.c] + '</small></span>' +
      '<span class="val">' + fmt(x.n) + '<small>' + pct + '%' + ex + '</small></span>' +
      '<span class="bar" aria-hidden="true"><span style="width:' + Math.max(1.5, (x.n / max) * 100).toFixed(1) + '%"></span></span>';
    ol.appendChild(li);
  });
}

function render() {
  if (!data) return;
  const s = data.season, ch = data.chain;
  if (s && s.counts) {
    const h1 = data.trend && data.trend.h1;
    renderRows($("seasonRows"), s.counts, h1 ? (c) => ' · <span class="up">+' + fmt(h1.delta[c]) + '</span> 1h' : null);
    $("seasonSrc").innerHTML = 'Source: <a href="https://dapp.4dlabs.space/tasks" target="_blank" rel="noopener">4D Labs dApp</a> public Season 1 stats · updated ' + ago(s.fetchedAt) + (s.stale ? " (last good read; the dApp did not answer)" : "") + (h1 ? "" : " · the 1h change appears once this board has an hour of history");
    const r = ranked(s.counts); const lead = r[0], second = r[1];
    $("leaderLine").innerHTML = "<b>" + NAME[lead.c] + "</b> leads Season 1 with " + fmt(lead.n) + " SNAPS. " + NAME[second.c] + " is 2nd, " + fmt(lead.n - second.n) + " behind.";
    const ai = r.findIndex((x) => x.c === "AFR"), a = r[ai];
    let t = "Africa is <b>#" + (ai + 1) + "</b> of six with " + fmt(a.n) + " SNAPS.";
    if (ai > 0) t += " " + fmt(r[ai - 1].n - a.n) + " behind " + NAME[r[ai - 1].c] + ".";
    if (ai < 5) t += " " + fmt(a.n - r[ai + 1].n) + " ahead of " + NAME[r[ai + 1].c] + ".";
    if (ch && ch.todayCounts) { const tr = ranked(ch.todayCounts), ti = tr.findIndex((x) => x.c === "AFR"); t += " Today: #" + (ti + 1) + " with " + fmt(tr[ti].n) + " check-ins."; }
    $("rallyStat").innerHTML = t;
    $("seasonRows").closest(".card").querySelector(".live").classList.toggle("off", !!s.stale);
  } else {
    $("seasonRows").innerHTML = '<li class="muted">The 4D Labs stats did not answer just now. Retrying every minute.</li>';
    $("leaderLine").textContent = "Live standings are unavailable right now; retrying.";
  }
  if (ch && ch.todayCounts) {
    renderRows($("todayRows"), ch.todayCounts);
    const tot = ORDER.reduce((a, c) => a + (ch.todayCounts[c] || 0), 0);
    const upto = ch.lastEventTs ? new Date(ch.lastEventTs * 1000).toISOString().slice(11, 16) + " UTC" : "";
    const lagMin = ch.behind ? Math.round(ch.behind * 0.45 / 60) : 0;
    $("todaySrc").innerHTML = fmt(tot) + ' check-ins on ' + ch.today + ' (UTC) so far, read from the <a href="https://bscscan.com/address/' + data.contract + '#events" target="_blank" rel="noopener">check-in contract</a> on BNB Chain' + (upto ? ", counted up to " + upto : "") + (lagMin >= 3 ? " (about " + lagMin + " min behind the chain, catching up)" : "") + (ch.partialToday ? " · some blocks today could not be read, so today is a partial count" : "") + ".";
    const y = $("yesterday");
    if (ch.yesterdayCounts) { const yr = ranked(ch.yesterdayCounts); y.hidden = false; y.innerHTML = "Yesterday (" + ch.yesterday + ") was won by <b>" + NAME[yr[0].c] + "</b> with " + fmt(yr[0].n) + " check-ins. Africa: " + fmt(ch.yesterdayCounts.AFR) + "."; }
    else y.hidden = true;
  } else {
    $("todayRows").innerHTML = '<li class="muted">The BNB Chain read did not answer just now. Retrying every minute.</li>';
  }
  drawCard();
}

async function load() {
  try {
    const r = await fetch("/api/standings", { cache: "no-store" });
    const j = await r.json();
    if (j && (j.season || j.chain)) data = j;
  } catch (e) { /* keep last data */ }
  if (!data) { $("seasonRows").innerHTML = '<li class="muted">Could not load standings. Retrying…</li>'; $("todayRows").innerHTML = ""; return; }
  render();
}

async function loadFeed() {
  const ul = $("feed");
  try {
    const j = await (await fetch("/api/official")).json();
    if (!j.posts || !j.posts.length) { ul.innerHTML = '<li class="muted">No region posts found right now. See <a href="https://x.com/4Dlabs_Official" target="_blank" rel="noopener">@4Dlabs_Official</a>.</li>'; return; }
    ul.innerHTML = "";
    for (const p of j.posts) {
      const d = new Date(p.ts || p.created_at);
      const txt = String(p.text || "").replace(/https?:\/\/\S+/g, "").trim();
      const li = el("li");
      li.innerHTML = '<time datetime="' + d.toISOString() + '">' + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + '</time><p>' + escH(txt.length > 280 ? txt.slice(0, 277) + "…" : txt) + '</p><a href="' + escH(p.url) + '" target="_blank" rel="noopener">View on X</a>';
      ul.appendChild(li);
    }
  } catch (e) { ul.innerHTML = '<li class="muted">Posts could not be loaded. See <a href="https://x.com/4Dlabs_Official" target="_blank" rel="noopener">@4Dlabs_Official</a>.</li>'; }
}

function tick() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  const p = (n) => String(n).padStart(2, "0");
  $("resetIn").textContent = "New day in " + p(Math.floor(s / 3600)) + ":" + p(Math.floor((s % 3600) / 60)) + ":" + p(s % 60);
}

// ---------- card ----------
const logo = new Image(); logo.src = "logo-4dlabs.png"; logo.onload = () => drawCard();
function handleVal() { let h = ($("handle").value || "").trim().replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15); return h ? "@" + h : ""; }
function drawCard() {
  const cv = $("cardCanvas"), x = cv.getContext("2d"), W = 1200, H = 675;
  const F = '"Space Grotesk", system-ui, sans-serif';
  x.clearRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0E0F14"); g.addColorStop(1, "#181A23"); x.fillStyle = g; x.fillRect(0, 0, W, H);
  // grid
  x.strokeStyle = "rgba(255,255,255,0.045)"; x.lineWidth = 1;
  for (let i = 0; i <= W; i += 48) { x.beginPath(); x.moveTo(i + .5, 0); x.lineTo(i + .5, H); x.stroke(); }
  for (let j = 0; j <= H; j += 48) { x.beginPath(); x.moveTo(0, j + .5); x.lineTo(W, j + .5); x.stroke(); }
  const CCOL = { AFR: [242,184,75], ASN: [255,90,95], EUR: [91,140,255], NAM: [61,220,151], SAM: [255,138,61], OCE: [46,211,230] };
  const cc = CCOL[pick] || [123,184,255];
  const accent = "rgb(" + cc.join(",") + ")";
  const rg = x.createRadialGradient(980, 160, 10, 980, 160, 520); rg.addColorStop(0, "rgba(" + cc.join(",") + ",0.28)"); rg.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  if (logo.complete && logo.naturalWidth) { const lh = 34, lw = lh * logo.naturalWidth / logo.naturalHeight; x.drawImage(logo, 64, 58, lw, lh); }
  x.textBaseline = "alphabetic"; x.fillStyle = "#AEAFB8"; x.font = "500 22px " + F; x.textAlign = "right";
  x.fillText("SEASON 1 · CONTINENT WAR", W - 64, 84);
  x.textAlign = "left"; x.fillStyle = "#F2F2F3"; x.font = "500 44px " + F; x.fillText("I checked in for", 64, 240);
  let size = 130; const nm = NAME[pick].toUpperCase();
  x.font = "700 " + size + "px " + F; while (x.measureText(nm).width > W - 128 && size > 60) { size -= 4; x.font = "700 " + size + "px " + F; }
  x.fillStyle = accent; x.fillText(nm, 60, 240 + size + 4);
  x.fillStyle = "#AEAFB8"; x.font = "400 26px " + F; x.fillText(LANDMARK[pick] + " landmark · on-chain on BNB Chain", 64, 240 + size + 56);
  // stats
  const s = data && data.season && data.season.counts, ch = data && data.chain && data.chain.todayCounts;
  const boxes = [];
  if (s) { const r = ranked(s), i = r.findIndex((q) => q.c === pick); boxes.push(["Season rank", "#" + (i + 1) + " of 6"], ["Season SNAPS", fmt(s[pick])]); }
  if (ch) { const r = ranked(ch), i = r.findIndex((q) => q.c === pick); boxes.push(["Today", "#" + (i + 1) + " · " + fmt(ch[pick])]); }
  let bx = 64; const by = 500;
  for (const [k, v] of boxes) {
    x.font = "700 34px " + F; const w = Math.max(190, x.measureText(v).width + 40);
    x.fillStyle = "rgba(255,255,255,0.06)"; x.strokeStyle = "rgba(255,255,255,0.12)"; x.lineWidth = 2;
    x.beginPath(); x.roundRect(bx, by, w, 92, 14); x.fill(); x.stroke();
    x.fillStyle = "#AEAFB8"; x.font = "500 18px " + F; x.fillText(k.toUpperCase(), bx + 20, by + 32);
    x.fillStyle = "#F2F2F3"; x.font = "700 34px " + F; x.fillText(v, bx + 20, by + 74);
    bx += w + 16;
  }
  const h = handleVal();
  x.textAlign = "right";
  if (h) { x.fillStyle = accent; x.font = "600 30px " + F; x.fillText(h, W - 64, by + 40); }
  x.fillStyle = "#AEAFB8"; x.font = "400 20px " + F; x.fillText(DOMAIN, W - 64, H - 40);
  x.textAlign = "left";
}
function cardBlob() { return new Promise((res) => $("cardCanvas").toBlob(res, "image/png")); }
function shareText(url) {
  let t = "I checked in for " + NAME[pick] + " on @4Dlabs_Official Season 1.";
  const s = data && data.season && data.season.counts;
  if (s) { const r = ranked(s), i = r.findIndex((q) => q.c === pick); t += " " + NAME[pick] + " is #" + (i + 1) + " with " + fmt(s[pick]) + " SNAPS."; }
  t += pick === "AFR" ? " Rally Africa!" : " Pick your side:";
  return t + (url ? "\n" + url : "");
}
let uploaded = { key: "", url: "" };
async function upload() {
  const blob = await cardBlob();
  const key = pick + "|" + handleVal() + "|" + JSON.stringify(data && data.season && data.season.counts && data.season.counts[pick]);
  if (uploaded.key === key && uploaded.url) return { url: uploaded.url, blob };
  const r = await fetch("/api/card?c=" + pick, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || ("HTTP " + r.status));
  uploaded = { key, url: j.url }; return { url: j.url, blob };
}
async function doShareX() {
  const b = $("shareX"); b.disabled = true; $("shareMsg").textContent = "Saving your card…";
  const w = window.open("", "_blank");
  try {
    const { url } = await upload();
    const intent = "https://x.com/intent/post?text=" + encodeURIComponent(shareText(url));
    if (w) w.location.href = intent; else location.href = intent;
    $("shareMsg").innerHTML = 'Card link: <a href="' + url + '" target="_blank" rel="noopener">' + url.replace("https://", "") + "</a>";
  } catch (e) { if (w) w.close(); $("shareMsg").textContent = "Could not save the card (" + e.message + "). Try Download instead."; }
  b.disabled = false;
}
async function doShareSheet() {
  $("shareMsg").textContent = "Preparing…";
  try {
    const { url, blob } = await upload();
    const file = new File([blob], "continent-war-" + pick.toLowerCase() + ".png", { type: "image/png" });
    const payload = { text: shareText(url), files: [file] };
    if (navigator.canShare && navigator.canShare(payload)) await navigator.share(payload);
    else await navigator.share({ text: shareText(url), url });
    $("shareMsg").textContent = "";
  } catch (e) { if (e && e.name === "AbortError") { $("shareMsg").textContent = ""; return; } $("shareMsg").textContent = "Sharing did not work here. Try Share on X or Download."; }
}
async function doDownload() {
  const blob = await cardBlob(); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "continent-war-" + pick.toLowerCase() + ".png"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function chips() {
  const c = $("chips"); c.innerHTML = "";
  for (const k of ORDER) {
    const b = el("button", "chip", NAME[k]); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(k === pick));
    b.onclick = () => { pick = k; chips(); drawCard(); };
    c.appendChild(b);
  }
}
chips();
$("handle").addEventListener("input", drawCard);
$("shareX").addEventListener("click", doShareX);
$("download").addEventListener("click", doDownload);
if (navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { $("shareSheet").hidden = false; $("shareSheet").addEventListener("click", doShareSheet); }
for (const id of ["seasonRows", "todayRows"]) $(id).innerHTML = '<li class="skel"></li><li class="skel"></li><li class="skel"></li>';
tick(); setInterval(tick, 1000);
if (document.fonts && document.fonts.load) document.fonts.load('700 40px "Space Grotesk"').then(drawCard).catch(() => {});
drawCard();
load(); setInterval(load, 60000);
loadFeed();
})();
