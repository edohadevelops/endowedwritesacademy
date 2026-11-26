(() => {
const { LABELS, PARTS } = window.PLAN_DATA;
const CFG = window.PLAN_CONFIG || {};
const IDS = Object.keys(LABELS);
const KEY = "endowed-academy-plan-v1";
const form = document.getElementById("plan");
const status = document.getElementById("status");

function value(id) {
  const box = form.querySelector(`[data-q="${id}"]`);
  if (box.dataset.kind === "long") return document.getElementById(id).value.trim();
  const picked = [...box.querySelectorAll(`input[name="${id}-pick"]:checked`)].map(el => el.value);
  const other = box.querySelector(".other");
  if (other && other.value.trim()) picked.push("Other: " + other.value.trim());
  return picked;
}
const filled = v => Array.isArray(v) ? v.length > 0 : v.length > 0;
const show = v => Array.isArray(v) ? v.join("; ") : v;

function snapshot() {
  const s = { name: form.elements.name.value };
  for (const id of IDS) {
    const box = form.querySelector(`[data-q="${id}"]`);
    if (box.dataset.kind === "long") s[id] = document.getElementById(id).value;
    else {
      s[id] = [...box.querySelectorAll(`input[name="${id}-pick"]:checked`)].map(el => el.value);
      const o = box.querySelector(".other"); if (o) s[id + "-other"] = o.value;
    }
  }
  return s;
}

function restore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  if (!s) return;
  if (s.name) form.elements.name.value = s.name;
  for (const id of IDS) {
    const box = form.querySelector(`[data-q="${id}"]`);
    if (box.dataset.kind === "long") document.getElementById(id).value = s[id] || "";
    else {
      for (const el of box.querySelectorAll(`input[name="${id}-pick"]`)) el.checked = (s[id] || []).includes(el.value);
      const o = box.querySelector(".other"); if (o) o.value = s[id + "-other"] || "";
    }
  }
}

function asText() {
  let i = 0, out = "THE ENDOWED ACADEMY PLAN from " + (form.elements.name.value.trim() || "Esther") + "\n";
  for (const [pi, p] of PARTS.entries()) {
    out += `\nPART ${pi + 1}: ${p.t.toUpperCase()}\n`;
    for (const id of p.ids) { i++; const v = value(id); out += `\n${i}. ${LABELS[id]}\n${filled(v) ? show(v) : "(no answer yet)"}\n`; }
  }
  return out;
}

function answersList() {
  let i = 0;
  return PARTS.flatMap((p, pi) => p.ids.map(id => ({ n: ++i, part: pi + 1, partTitle: p.t, id, question: LABELS[id], answer: value(id) })));
}

function refresh() {
  let done = 0;
  for (const id of IDS) {
    const ok = filled(value(id)); if (ok) done++;
    form.querySelector(`[data-q="${id}"]`).classList.toggle("done", ok);
  }
  document.getElementById("fill").style.width = (done / IDS.length * 100) + "%";
  document.getElementById("count").textContent = `${done} of ${IDS.length} answered`;
  return done;
}

function changed() {
  try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) {}
  refresh();
}
form.addEventListener("input", changed);
form.addEventListener("change", changed);

function showBackup() {
  const txt = asText();
  document.getElementById("wa").href = "https://wa.me/?text=" + encodeURIComponent(txt);
  document.getElementById("plain").value = txt;
  document.getElementById("backup").hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (document.getElementById("website").value) return; // a bot filled the hidden field
  const btn = document.getElementById("submit");
  const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("YOUR-PROJECT") && CFG.SUPABASE_KEY && !CFG.SUPABASE_KEY.includes("YOUR-KEY");
  if (!configured) { status.textContent = "Sending isn’t set up yet. Please use WhatsApp below for now."; showBackup(); return; }
  btn.disabled = true; status.textContent = "Sending…";
  try {
    const res = await fetch(CFG.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/academy_plan_responses", {
      method: "POST",
      headers: { "apikey": CFG.SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ name: form.elements.name.value.trim().slice(0, 200) || "Esther", answered: refresh(), answers: answersList(), summary: asText() }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(res.status + " " + t.slice(0, 160)); }
    status.textContent = "Thank you, Esther! Your answers have been sent to Amen. You can keep editing and send again any time.";
    document.getElementById("backup").hidden = true;
  } catch (err) {
    status.textContent = "That didn’t go through. Check your internet and try again, or use WhatsApp below. (Details for Amen: " + err.message + ")";
    showBackup();
  } finally { btn.disabled = false; }
});

document.getElementById("copy").addEventListener("click", () => {
  const txt = asText();
  const fallback = () => { const t = document.getElementById("plain"); t.hidden = false; t.focus(); t.select(); status.textContent = "Your answers are selected below. Tap Copy, then paste them into WhatsApp."; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => { status.textContent = "Copied. Paste it into your WhatsApp chat with Amen."; }, fallback);
  else fallback();
});

restore();
refresh();
})();
