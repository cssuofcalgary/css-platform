// CSS Exec Portal — Door tab: scan tickets, walk-ins, help-desk lists.

const doorState = { eventId: "", data: null, matches: [], scanner: null, lastCode: "", lastAt: 0, busy: false, refreshTimer: null };

async function openDoorTab() {
  if (!eventsState.loaded) await loadEvents();
  const events = activeEvents();
  if (!events.length) { $("scan-result").textContent = T.noEventsForPayments; return; }
  // The event with its doors open comes first. Volunteer phones have no event picker, so this is how they find it.
  if (!doorState.picked || !events.some((e) => e.id === doorState.eventId)) {
    const liveEvent = events.find((e) => e.entryOpen);
    doorState.eventId = liveEvent ? liveEvent.id : (events[0] ? events[0].id : "");
  }
  $("door-event").innerHTML = events.map((e) =>
    `<option value="${e.id}" ${e.id === doorState.eventId ? "selected" : ""}>${escapeHtml(e.name)} (${escapeHtml(e.date)})</option>`).join("");
  $("manual-input").placeholder = T.manualPlaceholder;
  showIdle();
  await loadDoor();
  clearInterval(doorState.refreshTimer);
  // Help desk: refresh every few seconds so recent scans show up live. Scanner phones don't need to refresh as often.
  doorState.refreshTimer = setInterval(async () => {
    if ($("tab-door").hidden || doorState.busy || document.hidden) return;
    if (SCANNER_MODE) await followLiveEvent();
    loadDoor(true);
  }, SCANNER_MODE ? 20000 : 6000);
}

/** Scanner phones have no picker: if the help desk switched doors to another event, move over to it. */
async function followLiveEvent() {
  const fresh = await api("listEvents");
  if (!fresh.ok) return;
  eventsState.events = fresh.events;
  const live = activeEvents().find((e) => e.entryOpen);
  if (live && live.id !== doorState.eventId) { doorState.eventId = live.id; showIdle(); }
}

/** `quiet` = the background refresh: if it fails, keep showing what we have instead of covering the scan result. */
async function loadDoor(quiet) {
  const reply = await api("doorList", { eventId: doorState.eventId });
  if (!reply.ok) {
    if (quiet && reply.error !== "NOT_LOGGED_IN") return;
    return handleEventError(reply, $("scan-result"));
  }
  doorState.data = reply;
  renderDoor();
}

/** Writes text only when it changed, so a background refresh doesn't touch the page for nothing. */
function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

/**
 * Keeps a list in step with `rows` ({ key, html }) without wiping it: nothing changed = no DOM writes,
 * a new key = a new row slides in at its place, a gone key = its row is removed, changed content = just that row is swapped.
 */
function syncList(ul, rows, emptyHtml) {
  if (!rows.length) {
    if (ul.dataset.empty !== "1") { ul.innerHTML = emptyHtml; ul.dataset.empty = "1"; ul.dataset.ready = "1"; }
    return;
  }
  if (ul.dataset.empty === "1") { ul.innerHTML = ""; ul.dataset.empty = ""; }
  const animate = ul.dataset.ready === "1";   // the very first fill appears at once; later arrivals slide in
  const existing = new Map();
  Array.from(ul.children).forEach((li) => existing.set(li.dataset.key, li));
  const wanted = new Set(rows.map((r) => r.key));
  existing.forEach((li, key) => { if (!wanted.has(key)) li.remove(); });
  rows.forEach((row, i) => {
    let li = existing.get(row.key);
    if (!li || li._html !== row.html) {
      const t = document.createElement("template");
      t.innerHTML = row.html.trim();
      const made = t.content.firstElementChild;
      made.dataset.key = row.key;
      made._html = row.html;
      if (!li && animate) {
        made.classList.add("new-scan");
        made.addEventListener("animationend", () => made.classList.remove("new-scan"), { once: true });
      }
      if (li) li.replaceWith(made);
      li = made;
    }
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
  });
  if (ul.dataset.ready !== "1") ul.dataset.ready = "1";
}

function renderDoor() {
  const d = doorState.data;
  setText($("live-inside"), String(d.counts.checkedIn));
  setText($("live-total"), String(d.counts.paid));
  setText($("live-sub"), d.counts.awaiting ? T.liveNotPaid(d.counts.awaiting) : "");
  setText($("entry-toggle"), SCANNER_MODE ? (d.event.entryOpen ? T.entryOpenPlain : T.entryClosedPlain)
    : d.event.entryOpen ? T.entryOpen : T.entryClosed);
  setText($("door-event-name"), T.scanningInto(d.event.name));
  $("entry-toggle").classList.toggle("on", !!d.event.entryOpen);
  const pressed = d.event.entryOpen ? "true" : "false";
  if ($("entry-toggle").getAttribute("aria-pressed") !== pressed) $("entry-toggle").setAttribute("aria-pressed", pressed);
  $("entry-card").classList.toggle("closed", !d.event.entryOpen);
  document.body.classList.toggle("entry-closed", !d.event.entryOpen);
  $("door-nav-live").hidden = !d.event.entryOpen;
  setText($("door-counts"), T.doorCounts(d.counts.checkedIn, d.counts.paid, d.counts.awaiting));

  // The server sends only the small lists (not paid / needs checking / latest check-ins), plus the real totals.
  const nobody = `<li class="muted small">${T.nobody}</li>`;
  const unpaid = d.tickets.filter((t) => t.status === "awaiting");
  const flagged = d.tickets.filter((t) => t.status === "paid" && t.flag && !t.checkedInAt);
  setText($("unpaid-title"), T.unpaidTitle(d.counts.awaiting));
  setText($("flagged-title"), T.flaggedTitle(d.counts.flagged !== undefined ? d.counts.flagged : flagged.length));
  syncList($("helpdesk-unpaid"), unpaid.map((t) => ({ key: t.id, html: personRow(t, true) })), nobody);
  syncList($("helpdesk-flagged"), flagged.map((t) => ({ key: t.id, html: personRow(t, false) })), nobody);

  const recent = d.tickets.filter((t) => t.checkedInAt).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt)).slice(0, 10);
  setText($("recent-title"), T.recentTitle(d.counts.checkedIn));
  syncList($("recent-list"), recent.map((t) => ({ key: t.id, html: `
    <li class="card door-person">
      <div>
        <div class="name"><strong>${escapeHtml(t.name)}</strong> · ${escapeHtml(t.ticketType)}</div>
        <div class="sub">${escapeHtml(shortTime(t.checkedInAt))}${t.checkedInBy ? " · " + escapeHtml(t.checkedInBy) : ""}</div>
      </div>
      <button class="link danger" data-undo="${t.id}">${T.undo}</button>
    </li>` })), nobody);
}

/** A person from the small lists or from the last typed search. */
function doorFind(id) {
  return (doorState.data ? doorState.data.tickets : []).find((x) => x.id === id) || doorState.matches.find((x) => x.id === id) || null;
}

function personRow(t, showPay) {
  const answers = Object.entries(t.answers || {}).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join(" · ");
  const action = t.checkedInAt ? `<span class="pill good">✓ ${escapeHtml(T.insideMark(shortTime(t.checkedInAt)))}</span>`
    : SCANNER_MODE && (t.status === "awaiting" || t.flag) ? `<span class="pill warn">${T.sendToDesk}</span>`   // the scanner never lets these in
    : t.status === "awaiting"
      ? (showPay ? `<button class="primary small-button" data-pay="${t.orderId}">${T.markPaidShort(money(t.orderTotal))}</button>` : "")
      : `<button class="primary small-button" data-checkin="${t.id}">${T.checkIn}</button>`;
  return `
    <li class="card door-person">
      <div>
        <div class="name"><strong>${escapeHtml(t.name)}</strong> · ${escapeHtml(t.ticketType)}</div>
        <div class="sub">${escapeHtml(t.orderCode || "")}${t.orderTotal ? " · " + money(t.orderTotal) : ""}${t.etransferName ? " · e-transfer: " + escapeHtml(t.etransferName) : ""}${answers ? " · " + answers : ""}</div>
        ${t.flag ? `<span class="flag">⚠ ${escapeHtml(t.flag)}</span>` : ""}
      </div>
      ${action}
    </li>`;
}

// ---- Scanning -------------------------------------------------------------------

async function toggleCamera() {
  if (doorState.scanner) return stopCamera();
  $("camera").hidden = false;
  try {
    doorState.scanner = new Html5Qrcode("camera");
    await doorState.scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, onCode, () => {});
    $("camera-toggle").hidden = true;   // no stop button: the camera runs until you leave the Door tab
    showIdle(T.readyToScan);
  } catch (err) {
    doorState.scanner = null;
    $("camera").hidden = true;
    showResult({ color: "red", message: T.cameraError });
  }
}

async function stopCamera() {
  try { await doorState.scanner.stop(); } catch (e) { /* already stopped */ }
  doorState.scanner = null;
  $("camera").hidden = true;
  $("camera").innerHTML = "";
  $("camera-toggle").textContent = T.startCamera;
  $("camera-toggle").hidden = false;
}

const PAUSE_AFTER_RESULT_MS = 2500;   // breather after each result (tap the result to skip it)
const SAME_CODE_IGNORE_MS = 10000;    // the same QR held in view isn't re-checked for 10 s

function onCode(text) {
  const now = Date.now();
  if (doorState.busy || now < (doorState.pausedUntil || 0)) return;
  if (text === doorState.lastCode && now - doorState.lastAt < SAME_CODE_IGNORE_MS) return;
  doorState.lastCode = text;
  doorState.lastAt = now;
  checkCode(text);
}

async function checkCode(code, atDesk) {
  doorState.busy = true;
  const known = findLocally(code);
  showIdle(known ? `${known.name} · ${T.checking}` : T.checking);   // name shows instantly; colour follows
  const reply = await api("scan", { eventId: doorState.eventId, code, atDesk: !!atDesk });
  doorState.busy = false;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { stopCamera(); signOutLocally(); return showLogin(errorText(reply)); }
    return showResult({ color: "red", message: errorText(reply) });
  }
  showResult(reply.result);
  if (reply.result.color === "green" && reply.result.person) markInsideLocally(reply.result.person.id);
}

/** Finds a ticket in the list the phone already has (by link, secret or ticket ID). */
function findLocally(code) {
  if (!doorState.data) return null;
  const text = String(code || "").trim();
  const secret = (/[?&]t=([A-Za-z0-9]+)/.exec(text) || [])[1] || (/^[a-f0-9]{32}$/i.test(text) ? text.toLowerCase() : "");
  const id = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return doorState.data.tickets.find((t) => (secret && t.secret === secret) || t.id === id) || null;
}

/** Updates the counts on screen without reloading everything (the 30-second refresh catches up the rest). */
function markInsideLocally(ticketId) {
  const t = doorState.data && doorState.data.tickets.find((x) => x.id === ticketId);
  if (!t || t.checkedInAt) return;
  t.checkedInAt = new Date().toISOString();
  doorState.data.counts.checkedIn++;
  renderDoor();
}

function showIdle(text) {
  const box = $("scan-result");
  box.className = "scan-result idle";
  box.textContent = text || (SCANNER_MODE || doorState.scanner ? T.readyToScan : T.deskReady);
}

function showResult(result) {
  const box = $("scan-result");
  const p = result.person;
  const answers = p ? Object.entries(p.answers || {}).map(([k, v]) => `${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong>`).join(" · ") : "";
  box.className = "scan-result " + result.color;
  box.innerHTML = `
    ${p ? `<div class="big-name">${escapeHtml(p.name)}</div><div class="detail">${escapeHtml(p.ticketType)} · ${escapeHtml(p.id)}</div>` : ""}
    <div>${escapeHtml(result.message)}</div>
    ${answers ? `<div class="detail">${answers}</div>` : ""}
    ${doorState.scanner ? `<div class="detail tap-hint">${T.tapForNext}</div>` : ""}`;
  doorState.pausedUntil = Date.now() + PAUSE_AFTER_RESULT_MS;
  feedback(result.color);
}

/** Tapping the result card = "next person": resume scanning straight away. */
function onResultTap() {
  if (!doorState.scanner || $("scan-result").classList.contains("idle")) return;
  doorState.pausedUntil = 0;
  doorState.lastCode = "";   // allow re-scanning the same code on purpose
  showIdle(T.readyToScan);
}

/** Beep + buzz so the door person doesn't have to stare at the screen. */
function feedback(color) {
  try {
    const ctx = feedback.ctx = feedback.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = color.startsWith("green") ? [880] : color === "orange" ? [520, 520] : [220];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.16);
    });
  } catch (e) { /* no sound: fine */ }
  if (navigator.vibrate) navigator.vibrate(color.startsWith("green") ? 80 : [120, 80, 120]);
}

// ---- Typed lookups (QR won't scan, no phone) --------------------------------------

async function onManualSubmit(ev) {
  ev.preventDefault();
  const q = $("manual-input").value.trim();
  if (!q) return;
  if (/^tkt/i.test(q) || /[?&]t=/.test(q)) { $("manual-results").innerHTML = ""; return checkCode(q); }
  if (q.length < 2) return;
  $("manual-results").innerHTML = `<li class="muted small">${T.searching}</li>`;
  const reply = await api("doorList", { eventId: doorState.eventId, q });   // the server searches everyone (up to 20 matches)
  if (!reply.ok) { $("manual-results").innerHTML = ""; return showResult({ color: "red", message: errorText(reply) }); }
  doorState.matches = reply.matches || [];
  $("manual-results").innerHTML = doorState.matches.length ? doorState.matches.map((t) => personRow(t, true)).join("") : `<li class="muted small">${T.noMatch}</li>`;
}

async function onDoorListClick(ev) {
  const checkin = ev.target.closest("[data-checkin]");
  const pay = ev.target.closest("[data-pay]");
  const undo = ev.target.closest("[data-undo]");
  if (checkin) {
    // Typing a name / tapping a list = the help desk, so flagged people can be let in after checking.
    const t = doorFind(checkin.dataset.checkin);
    if (t && t.flag && !confirm(T.confirmDeskCheckIn(t.name, t.flag))) return;
    checkin.disabled = true;
    await checkCode(checkin.dataset.checkin, true);
    $("manual-results").innerHTML = "";
  }
  if (undo) {
    const t = doorFind(undo.dataset.undo);
    if (!confirm(T.confirmUndo(t ? t.name : ""))) return;
    undo.disabled = true;
    const reply = await api("undoCheckIn", { ticketId: undo.dataset.undo });
    if (!reply.ok) { undo.disabled = false; return showResult({ color: "red", message: errorText(reply) }); }
    showIdle(T.undone(t ? t.name : ""));
    doorState.lastCode = "";
    await loadDoor();
  }
  if (pay) {
    const t = (doorState.data.tickets.concat(doorState.matches)).find((x) => x.orderId === pay.dataset.pay);
    if (!confirm(T.confirmPaid(money(t.orderTotal), t.orderCode, t.etransferName || t.payerName))) return;
    pay.disabled = true;
    const siteUrl = new URL(PUBLIC_SITE_URL, location.href).href;
    let reply = await api("markOrderPaid", { orderId: pay.dataset.pay, siteUrl, force: true });   // door: always let paying people in
    if (!reply.ok) { pay.disabled = false; return showResult({ color: "red", message: errorText(reply) }); }
    await loadDoor();
    onManualSubmit(new Event("submit"));
  }
}

// ---- Walk-ins -----------------------------------------------------------------------

function openWalkIn() {
  const types = doorState.data ? doorState.data.event.ticketTypes : [];
  $("wi-types").innerHTML = types.map((t, i) => `
    <label class="check"><input type="radio" name="wi-type" value="${escapeHtml(t.id)}" data-member="${t.needsMembership ? 1 : 0}" ${i === types.length - 1 ? "checked" : ""}>
      ${escapeHtml(t.name)} · ${money(t.price)}</label>`).join("");
  ["wi-name", "wi-ucid", "wi-member-id"].forEach((id) => { $(id).value = ""; });
  $("wi-error").hidden = true;
  updateWalkInMember();
  $("walkin-form").hidden = false;
  $("wi-name").focus();
}

function updateWalkInMember() {
  const picked = document.querySelector('input[name="wi-type"]:checked');
  $("wi-member").hidden = !(picked && picked.dataset.member === "1");
}

async function onWalkInSubmit(ev) {
  ev.preventDefault();
  const picked = document.querySelector('input[name="wi-type"]:checked');
  const walkIn = {
    name: $("wi-name").value, ucid: $("wi-ucid").value, memberId: $("wi-member-id").value,
    ticketTypeId: picked ? picked.value : "",
    method: document.querySelector('input[name="wi-method"]:checked').value
  };
  $("wi-submit").disabled = true;
  const reply = await api("walkIn", { eventId: doorState.eventId, walkIn });
  $("wi-submit").disabled = false;
  if (!reply.ok) { $("wi-error").textContent = errorText(reply); $("wi-error").hidden = false; return; }
  $("walkin-form").hidden = true;
  showResult(reply.result);
  loadDoor();
}

// ---- Entry open / closed --------------------------------------------------------------

async function toggleEntry() {
  if (SCANNER_MODE) return;   // opening and closing entry is for the help desk
  const open = !doorState.data.event.entryOpen;
  if (!open && !confirm(T.confirmCloseEntry)) return;
  $("entry-toggle").disabled = true;

  // Only one event takes check-ins at a time: turning entry on closes any other event that still has its doors open.
  if (open) {
    const fresh = await api("listEvents");   // a fresh look, in case another exec opened a different event
    if (fresh.ok) { eventsState.events = fresh.events; eventsState.counts = fresh.counts || {}; }
    const others = eventsState.events.filter((e) => e.entryOpen && e.id !== doorState.eventId && e.status !== "archived");
    if (others.length) {
      const names = others.map((e) => e.name).join(" and ");
      for (const other of others) {
        const closed = await api("setEntryOpen", { eventId: other.id, open: false });
        if (!closed.ok) { $("entry-toggle").disabled = false; return showResult({ color: "red", message: errorText(closed) }); }
        other.entryOpen = false;
      }
      showToast(T.doorsSwitched(names));
    }
  }

  const reply = await api("setEntryOpen", { eventId: doorState.eventId, open });
  $("entry-toggle").disabled = false;
  if (!reply.ok) return showResult({ color: "red", message: errorText(reply) });
  doorState.data.event.entryOpen = open;
  const mine = eventsState.events.find((e) => e.id === doorState.eventId);
  if (mine) mine.entryOpen = open;   // so the Events tab shows the right DOORS OPEN pill
  renderEvents();
  renderDoor();
}

// ---- Wire up ------------------------------------------------------------------------

$("door-event").addEventListener("change", () => { doorState.eventId = $("door-event").value; doorState.picked = true; showIdle(); loadDoor(); });
$("entry-toggle").addEventListener("click", toggleEntry);
$("scan-result").addEventListener("click", onResultTap);
$("camera-toggle").addEventListener("click", toggleCamera);
$("walkin-button").addEventListener("click", openWalkIn);
$("wi-cancel").addEventListener("click", () => { $("walkin-form").hidden = true; });
$("wi-types").addEventListener("change", updateWalkInMember);
$("walkin-form").addEventListener("submit", onWalkInSubmit);
$("manual-form").addEventListener("submit", onManualSubmit);
["manual-results", "helpdesk-unpaid", "helpdesk-flagged", "recent-list"].forEach((id) => $(id).addEventListener("click", onDoorListClick));
