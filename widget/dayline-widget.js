// Lumo widget for Scriptable (iPhone / iPad). (The script keeps its old file name, dayline-widget.js.)
// Shows what is on now, what is next, and how many quick reviews are ready, in Lumo's black, grey and amber.
// First run: open this script in Scriptable and tap the play button. It asks for a pairing code from
// Lumo: Settings > Devices > Pair a desk buddy. Then add a Scriptable widget to your home or lock screen.
// No passwords are stored here: just a device token in the iOS Keychain. Unpair any time in Lumo Settings.
// If the internet is off, the widget draws its last saved copy and says how old it is.

const API = "https://xohfloyqwjymisomlbgl.supabase.co/functions/v1/dayline-push";
const APP = "https://abdullahmzubair.github.io/dayline/";
const KEY = "dayline-widget-token";
const CACHE = "dayline-widget-state";
const STALE_MIN = 30; /* show "updated N min ago" when the data is older than this */

const C = {
  bg: new Color("#0B0B0C"),
  fg: new Color("#F4F4F2"),
  muted: new Color("#A1A1A6"),
  amber: new Color("#F5B94A")
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
  a.title = "Pair with Lumo";
  a.message = "In Lumo: Settings > Devices > Pair a desk buddy. Type the 8-character code here.";
  a.addTextField("e.g. 9JDH-VVC6", "");
  a.addAction("Pair");
  a.addCancelAction("Cancel");
  if (await a.presentAlert() === -1) return false;
  const code = a.textFieldValue(0);
  const name = Device.isPad() ? "iPad widget" : "iPhone widget";
  const { status, json } = await call("pair", { code, name });
  if (status === 200 && json && json.token) {
    Keychain.set(KEY, json.token);
    const ok = new Alert(); ok.title = "Paired"; ok.message = "Now add a Scriptable widget to your home or lock screen and choose this script."; ok.addAction("OK"); await ok.presentAlert();
    return true;
  }
  const bad = new Alert(); bad.title = "Couldn't pair"; bad.message = (json && json.error) || "Check your internet and try again."; bad.addAction("OK"); await bad.presentAlert();
  return false;
}

/* The fresh state, or the last saved copy (marked with when it was fetched) if the network fails. */
async function getState() {
  const token = Keychain.contains(KEY) ? Keychain.get(KEY) : null;
  if (!token) return { error: "Open the Lumo script in Scriptable to pair it." };
  const { status, json } = await call("state", {}, token);
  if (status === 200 && json) { try { Keychain.set(CACHE, JSON.stringify({ at: Date.now(), json })); } catch (e) {} return { ...json, fetchedAt: Date.now() }; }
  if (status === 401) { Keychain.remove(KEY); return { error: "Unpaired. Open the Lumo script in Scriptable to pair again." }; }
  if (Keychain.contains(CACHE)) { try { const c = JSON.parse(Keychain.get(CACHE)); return { ...c.json, fetchedAt: c.at, offline: true }; } catch (e) {} }
  return { error: "Can't reach Lumo right now." };
}

const t12 = hhmm => { if (!hhmm) return ""; const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`; };
const toMin = hhmm => { const [h, m] = String(hhmm || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const dur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${Math.round(m)}m`;
function text(stack, s, size, color, weight = "regular", lines = 1) {
  const t = stack.addText(String(s));
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = 0.7;
  return t;
}
/* How old the data is, in minutes: from the server's generatedAt when there is one, else from when this phone last fetched it. */
function ageMin(s, nowMs) {
  const g = Date.parse(s.generatedAt), at = g > 0 ? g : s.fetchedAt;
  return at ? Math.max(0, Math.floor((nowMs - at) / 60000)) : 0;
}
const agoText = m => m >= 120 ? `${Math.floor(m / 60)} h` : `${m} min`;
/* The small stale mark, or "" when the data is fresh. */
function staleMark(s, nowMs) { const m = ageMin(s, nowMs); return m > STALE_MIN ? `updated ${agoText(m)} ago` : ""; }
/* The clock the data was made for, moved forward by how long ago that was, so "min left" stays right on an old copy. */
function clockMin(s, nowMs) { return toMin(s.time) + ageMin(s, nowMs); }
function minutesLeft(s, nowMs) { return s.current ? Math.max(0, toMin(s.current.end) - clockMin(s, nowMs)) : null; }

/* The three lines: Now, Next, and reviews or the first step. */
function lines(s, nowMs) {
  const run = s.running, cur = s.current, nx = s.next, sg = s.suggest;
  let now;
  if (run) now = { title: run.title, sub: `${Math.round(run.elapsedMin)}m in`, label: "Now" };
  else if (cur) { const left = minutesLeft(s, nowMs); now = { title: cur.title, sub: left != null ? `${dur(left)} left` : `until ${t12(cur.end)}`, label: "Now" }; }
  else if (sg) now = { title: sg.title, sub: dur(sg.minutes), label: "Up next" };
  else now = { title: "Nothing planned", sub: "Rest is allowed.", label: "Now" };
  const next = nx ? { title: nx.title, sub: t12(nx.start) } : null;
  const rv = +s.reviewsDue || 0, step = s.firstStep || null;
  let third = null;
  if (rv > 0) third = `${rv} quick review${rv === 1 ? "" : "s"} ready`;
  else if (step) third = `First step: ${step}`;
  return { now, next, third };
}
function build(s, family) {
  const nowMs = Date.now(), w = new ListWidget();
  w.url = APP;
  w.refreshAfterDate = new Date(nowMs + 15 * 60 * 1000);
  if (s.error) {
    if (family.startsWith("accessory")) { text(w, "Lumo: tap to pair", 12, Color.white()); return w; }
    w.backgroundColor = C.bg; text(w, "Lumo", 13, C.amber, "bold"); w.addSpacer(6); text(w, s.error, 13, C.fg, "regular", 4); return w;
  }
  const L = lines(s, nowMs), ex = (s.upcoming || [])[0], stale = staleMark(s, nowMs);
  /* Lock screen */
  if (family === "accessoryInline") { text(w, `${L.now.label}: ${L.now.title}`, 12, Color.white()); return w; }
  if (family === "accessoryCircular") {
    const st = w.addStack(); st.layoutVertically(); st.centerAlignContent();
    if (+s.reviewsDue > 0) { text(st, String(s.reviewsDue), 20, Color.white(), "bold"); text(st, "reviews", 9, Color.white()); }
    else if (ex) { text(st, String(ex.days), 20, Color.white(), "bold"); text(st, "days", 9, Color.white()); }
    else { text(st, `${s.today.done}/${s.today.planned}`, 16, Color.white(), "bold"); text(st, "done", 9, Color.white()); }
    return w;
  }
  if (family === "accessoryRectangular") {
    text(w, L.now.label, 10, Color.white(), "semibold"); text(w, L.now.title, 14, Color.white(), "bold", 2);
    text(w, L.third || L.now.sub, 11, Color.white());
    return w;
  }
  /* Home screen: black, off-white, grey, and one amber dot beside "Now". */
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 12, 14);
  const big = family !== "small", tSize = big ? 16 : 14;
  const head = w.addStack(); head.layoutHorizontally(); head.centerAlignContent(); head.spacing = 6;
  const dot = head.addStack(); dot.size = new Size(8, 8); dot.backgroundColor = C.amber; dot.cornerRadius = 4;
  text(head, L.now.label, 11, C.muted, "semibold");
  head.addSpacer();
  text(head, L.now.sub, 11, C.muted);
  w.addSpacer(4);
  text(w, L.now.title, tSize, C.fg, "bold", big ? 2 : 3);
  if (L.next) {
    w.addSpacer(8);
    const nh = w.addStack(); nh.layoutHorizontally(); nh.centerAlignContent();
    text(nh, "Next", 11, C.muted, "semibold"); nh.addSpacer(); text(nh, L.next.sub, 11, C.muted);
    w.addSpacer(2);
    text(w, L.next.title, big ? 14 : 12, C.fg, "semibold", 1);
  }
  w.addSpacer();
  if (L.third) text(w, L.third, 11, C.muted, "regular", family === "small" ? 2 : 1);
  if (stale) text(w, stale, 10, C.muted);
  return w;
}

const family = config.widgetFamily || "medium";
if (config.runsInApp && !Keychain.contains(KEY)) await pair();
const state = await getState();
const widget = build(state, family);
if (config.runsInWidget) Script.setWidget(widget);
else {
  const a = new Alert(); a.title = "Lumo widget";
  a.message = Keychain.contains(KEY) ? "Paired with Lumo. Preview a size, or unpair." : "Not paired yet.";
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
