(() => {
const CFG = window.PLAN_CONFIG || {};
const BASE = (CFG.SUPABASE_URL || "").replace(/\/$/, "");
const SKEY = "endowed-plan-session";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let session = null, rows = [], current = null;

try { session = JSON.parse(sessionStorage.getItem(SKEY) || "null"); } catch (e) {}
if (session && session.expires_at * 1000 < Date.now()) session = null;

function fmt(ts) {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return ts; }
}

async function signIn(email, password) {
  const r = await fetch(BASE + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: CFG.SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error_description || body.msg || "Sign in failed.");
  session = { access_token: body.access_token, expires_at: body.expires_at || Math.floor(Date.now() / 1000) + 3600, email: body.user && body.user.email };
  try { sessionStorage.setItem(SKEY, JSON.stringify(session)); } catch (e) {}
}

function signOut() {
  session = null; rows = []; current = null;
  try { sessionStorage.removeItem(SKEY); } catch (e) {}
  $("app").hidden = true; $("login").hidden = false;
}

async function load() {
  $("summary-line").textContent = "Loading…"; $("app-msg").textContent = "";
  const r = await fetch(BASE + "/rest/v1/academy_plan_responses?select=*&order=created_at.desc", {
    headers: { apikey: CFG.SUPABASE_KEY },
  });
  if (!r.ok) { $("summary-line").textContent = ""; $("app-msg").textContent = "Couldn’t load responses (" + r.status + "). Check that the SQL has been run."; return; }
  rows = await r.json();
  renderList();
}

function renderList() {
  if (!rows.length) {
    $("summary-line").textContent = "No submissions yet.";
    $("subs").innerHTML = "";
    $("detail-bar").hidden = true;
    $("detail").innerHTML = `<div class="empty-state"><p>No answers yet. When Esther taps Send, her answers show up here.</p><p>If you’re sure she sent them and nothing shows, check the email in the SQL matches the one you signed in with.</p></div>`;
    return;
  }
  $("summary-line").textContent = `${rows.length} submission${rows.length === 1 ? "" : "s"}, newest first.`;
  $("subs").innerHTML = rows.map((r, i) => `<button type="button" class="sub" data-i="${i}" aria-pressed="false"><b>${esc(r.name || "No name")}${i === 0 ? " (latest)" : ""}</b><span>${esc(fmt(r.created_at))} · ${esc(r.answered ?? "?")} of 32 answered</span></button>`).join("");
  select(current && rows.includes(current) ? rows.indexOf(current) : 0);
}

function select(i) {
  current = rows[i];
  for (const b of document.querySelectorAll(".sub")) b.setAttribute("aria-pressed", String(Number(b.dataset.i) === i));
  $("detail-bar").hidden = false;
  $("detail-meta").textContent = `${current.name || "No name"} · sent ${fmt(current.created_at)}`;
  const list = Array.isArray(current.answers) ? current.answers : [];
  const parts = [];
  for (const a of list) {
    let p = parts.find(x => x.part === a.part);
    if (!p) { p = { part: a.part, title: a.partTitle, items: [] }; parts.push(p); }
    p.items.push(a);
  }
  $("detail").innerHTML = parts.map(p => `<section class="part"><h2><span>Part ${esc(p.part)}</span>${esc(p.title)}</h2>${p.items.map(a => {
    const empty = Array.isArray(a.answer) ? !a.answer.length : !String(a.answer || "").trim();
    const body = empty ? `<p>No answer</p>` : Array.isArray(a.answer) ? `<ul>${a.answer.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>${esc(a.answer)}</p>`;
    return `<div class="answer${empty ? " empty" : ""}"><h3><span class="num">${esc(a.n)}</span><span>${esc(a.question)}</span></h3>${body}</div>`;
  }).join("")}</section>`).join("");
}

$("subs").addEventListener("click", e => { const b = e.target.closest(".sub"); if (b) select(Number(b.dataset.i)); });
$("reload").addEventListener("click", () => load());

$("copy-one").addEventListener("click", () => {
  if (!current) return;
  const txt = current.summary || "";
  const done = () => { $("app-msg").textContent = "Copied. Paste it into your chat with Claude to plan the build."; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { $("app-msg").textContent = "Copy was blocked. Select the answers on the page instead."; });
});

$("login").addEventListener("submit", async e => {
  e.preventDefault();
  $("login-err").textContent = "";
  if (!BASE || BASE.includes("YOUR-PROJECT")) { $("login-err").textContent = "Add your Supabase details to config.js first."; return; }
  const btn = $("login-btn"); btn.disabled = true;
  try {
    await signIn($("email").value.trim(), $("password").value);
    $("password").value = "";
    $("login").hidden = true; $("app").hidden = false;
    await load();
  } catch (err) { $("login-err").textContent = err.message; }
  finally { btn.disabled = false; }
});

// No sign-in: the page shows the responses straight away.
$("login").hidden = true; $("app").hidden = false;
if (!BASE || BASE.includes("YOUR-PROJECT")) $("app-msg").textContent = "Supabase details are missing from config.js.";
else load();
})();
