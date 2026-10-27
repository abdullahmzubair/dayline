// Dayline widget for Scriptable (iPhone / iPad).
// Shows what's on now or next, your highlight, today's progress and your next exam.
// First run: open this script in Scriptable and tap ▶. It asks for a pairing code from
// Dayline → ⚙ Settings → Desk buddy → Pair a desk buddy. Then add a Scriptable widget to your home or lock screen.
// No passwords are stored here: just a device token in the iOS Keychain. Unpair any time in Dayline Settings.

const API = "https://xohfloyqwjymisomlbgl.supabase.co/functions/v1/dayline-push";
const APP = "https://abdullahmzubair.github.io/dayline/";
const KEY = "dayline-widget-token";
const CACHE = "dayline-widget-state";

const C = {
  bg: Color.dynamic(new Color("#F4F1E8"), new Color("#161D19")),
  card: Color.dynamic(new Color("#FFFFFF"), new Color("#1D2621")),
  fg: Color.dynamic(new Color("#1A2620"), new Color("#E3EAE5")),
  muted: Color.dynamic(new Color("#5E6B64"), new Color("#93A299")),
  accent: Color.dynamic(new Color("#1D6A4D"), new Color("#5DC497")),
  now: Color.dynamic(new Color("#D4511C"), new Color("#FF7C46"))
};

async function call(action, body, token) {
  const r = new Request(`${API}?buddy=${action}`);
  r.method = "POST";
  r.headers = { "Content-Type": "application/json", ...(token ? { "x-buddy-token": token } : {}) };
  r.body = JSON.stringify(body || {});
  r.timeoutInterval = 15;
  let json = null;
  try { json = await r.loadJSON(); } catch (e) { json = null; }
  const status = r.response ? r.response.statusCode : 0;
  return { status, json };
}

async function pair() {
  const a = new Alert();
  a.title = "Pair with Dayline";
  a.message = "In Dayline: ⚙ Settings → Desk buddy → Pair a desk buddy. Type the 8-character code here.";
  a.addTextField("e.g. 9JDH-VVC6", "");
  a.addAction("Pair");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return false;
  const code = a.textFieldValue(0);
  const name = Device.isPad() ? "iPad widget" : "iPhone widget";
  const { status, json } = await call("pair", { code, name });
  if (status === 200 && json && json.token) {
    Keychain.set(KEY, json.token);
    const ok = new Alert(); ok.title = "Paired ✅"; ok.message = "Now add a Scriptable widget to your home or lock screen and choose the Dayline script."; ok.addAction("OK"); await ok.presentAlert();
    return true;
  }
  const bad = new Alert(); bad.title = "Couldn't pair"; bad.message = (json && json.error) || "Check your internet and try again."; bad.addAction("OK"); await bad.presentAlert();
  return false;
}

async function getState() {
  const token = Keychain.contains(KEY) ? Keychain.get(KEY) : null;
  if (!token) return { error: "Open the Dayline script in Scriptable to pair it." };
  const { status, json } = await call("state", {}, token);
  if (status === 200 && json) { Keychain.set(CACHE, JSON.stringify({ at: Date.now(), json })); return json; }
  if (status === 401) { Keychain.remove(KEY); return { error: "Unpaired. Open the Dayline script in Scriptable to pair again." }; }
  if (Keychain.contains(CACHE)) { const c = JSON.parse(Keychain.get(CACHE)); return { ...c.json, stale: true }; }
  return { error: "Can't reach Dayline right now." };
}

const t12 = hhmm => { if (!hhmm) return ""; const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`; };
const dur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`;
function text(stack, s, size, color, weight = "regular", lines = 1) {
  const t = stack.addText(String(s));
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = 0.7;
  return t;
}
/* What to headline: running task, else what's on now, else the next thing, else the suggestion. */
function headline(s) {
  if (s.running) return { k: "FOCUSING", title: s.running.title, sub: `${Math.round(s.running.elapsedMin)}m in${s.running.project ? " · " + s.running.project : ""}`, color: s.running.color };
  if (s.current) return { k: "NOW", title: s.current.title, sub: `until ${t12(s.current.end)}${s.current.project ? " · " + s.current.project : ""}`, color: s.current.color };
  if (s.next) return { k: `NEXT · ${t12(s.next.start)}`, title: s.next.title, sub: s.next.project || dur(s.next.minutes), color: s.next.color };
  if (s.suggest) return { k: "UP NEXT", title: s.suggest.title, sub: `${dur(s.suggest.minutes)}${s.suggest.project ? " · " + s.suggest.project : ""}`, color: s.suggest.color };
  return { k: "TODAY", title: "Nothing planned", sub: "Rest is allowed.", color: "#8C9790" };
}
function block(w, h, titleSize, lines) {
  const row = w.addStack(); row.layoutHorizontally(); row.spacing = 8;
  const bar = row.addStack(); bar.size = new Size(4, 0); bar.backgroundColor = new Color(h.color || "#8C9790"); bar.cornerRadius = 2;
  const col = row.addStack(); col.layoutVertically(); col.spacing = 2;
  text(col, h.k, 10, C.muted, "semibold");
  text(col, h.title, titleSize, C.fg, "bold", lines);
  text(col, h.sub, 11, C.muted);
}
function build(s, family) {
  const w = new ListWidget();
  w.url = APP;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (s.error) {
    if (family.startsWith("accessory")) { text(w, "Dayline: tap to pair", 12, Color.white()); return w; }
    w.backgroundColor = C.bg; text(w, "Dayline", 13, C.accent, "bold"); w.addSpacer(6); text(w, s.error, 13, C.fg, "regular", 4); return w;
  }
  const h = headline(s), ex = (s.upcoming || [])[0];
  /* Lock screen */
  if (family === "accessoryInline") { text(w, `${h.k === "NOW" ? "Now" : "Next"}: ${h.title}`, 12, Color.white()); return w; }
  if (family === "accessoryCircular") {
    const st = w.addStack(); st.layoutVertically(); st.centerAlignContent();
    if (ex) { text(st, String(ex.days), 20, Color.white(), "bold"); text(st, "days", 9, Color.white()); }
    else { text(st, `${s.today.done}/${s.today.planned}`, 16, Color.white(), "bold"); text(st, "done", 9, Color.white()); }
    return w;
  }
  if (family === "accessoryRectangular") {
    text(w, h.k, 10, Color.white(), "semibold"); text(w, h.title, 14, Color.white(), "bold", 2);
    text(w, ex ? `${ex.days}d to ${ex.name}` : h.sub, 11, Color.white());
    return w;
  }
  /* Home screen */
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 12, 14);
  const top = w.addStack(); top.layoutHorizontally(); top.centerAlignContent();
  text(top, "Dayline", 12, C.accent, "bold"); top.addSpacer();
  text(top, s.stale ? "offline" : `${s.weekday} ${t12(s.time)}`, 10, C.muted);
  w.addSpacer(8);
  if (family === "small") {
    block(w, h, 15, 3);
    w.addSpacer();
    text(w, ex ? `${ex.days}d · ${ex.name}` : `✓ ${s.today.done} done · ${dur(s.today.focusMin)}`, 10, C.muted);
    return w;
  }
  const body = w.addStack(); body.layoutHorizontally(); body.spacing = 12;
  const left = body.addStack(); left.layoutVertically(); left.size = new Size(family === "large" ? 0 : 170, 0);
  block(left, h, 16, family === "large" ? 3 : 2);
  if (s.next && h.k !== `NEXT · ${t12(s.next.start)}` && family !== "small") {
    left.addSpacer(8);
    block(left, { k: `THEN · ${t12(s.next.start)}`, title: s.next.title, sub: s.next.project || dur(s.next.minutes), color: s.next.color }, 13, 1);
  }
  const right = body.addStack(); right.layoutVertically(); right.spacing = 4;
  if (s.highlight) { text(right, "⭐ HIGHLIGHT", 10, C.muted, "semibold"); text(right, s.highlight.done ? `✓ ${s.highlight.title}` : s.highlight.title, 12, C.fg, "semibold", 2); }
  right.addSpacer(4);
  text(right, `✓ ${s.today.done} done · ${dur(s.today.focusMin)} focus`, 11, C.muted);
  for (const u of (s.upcoming || []).slice(0, family === "large" ? 3 : 1)) text(right, `⏳ ${u.days}d · ${u.name}`, 11, C.fg);
  return w;
}

const family = config.widgetFamily || "medium";
if (config.runsInApp && !Keychain.contains(KEY)) await pair();
const state = await getState();
const widget = build(state, family);
if (config.runsInWidget) Script.setWidget(widget);
else {
  const a = new Alert(); a.title = "Dayline widget";
  a.message = Keychain.contains(KEY) ? "Paired with Dayline. Preview a size, or unpair." : "Not paired yet.";
  a.addAction("Preview small"); a.addAction("Preview medium"); a.addAction("Preview large");
  if (Keychain.contains(KEY)) a.addDestructiveAction("Unpair this device");
  a.addCancelAction("Done");
  const i = await a.presentAlert();
  if (i === 0) await build(state, "small").presentSmall();
  else if (i === 1) await build(state, "medium").presentMedium();
  else if (i === 2) await build(state, "large").presentLarge();
  else if (i === 3) { Keychain.remove(KEY); if (Keychain.contains(CACHE)) Keychain.remove(CACHE); }
}
Script.complete();
