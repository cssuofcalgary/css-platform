// CSS ticket page: ticket.html?t=<secret>. Shows the person's QR code for the door.
// The QR code holds this page's own address, so any phone camera (or the CSS scanner) can read it.

const $ = (id) => document.getElementById(id);

async function api(action, details = {}, timeoutMs = 30000) {
  try {
    const res = await fetch(API_URL, {
      signal: AbortSignal.timeout(timeoutMs),   // never stay on "Loading…" forever
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...details })
    });
    const data = await res.json();
    if (data && data.site) applySite(data.site);
    return data;
  } catch (err) {
    return { ok: false, error: "NETWORK" };
  }
}

/** Contact email + Instagram come from the Exec Portal's Settings (config.js is only the fallback). */
function applySite(site) {
  if (!site) return;
  if (site.contactEmail) { $("contact-link").textContent = site.contactEmail; $("contact-link").href = "mailto:" + site.contactEmail; }
  if (/^https:\/\//.test(site.instagramUrl || "")) $("instagram-link").href = site.instagramUrl;
}

async function start() {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
  $("contact-link").textContent = CONTACT_EMAIL;
  $("contact-link").href = "mailto:" + CONTACT_EMAIL;
  $("instagram-link").href = INSTAGRAM_URL;

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});   // lets this page itself open without signal

  const secret = new URLSearchParams(location.search).get("t") || "";
  const cached = readCache(secret);
  // With a saved copy, wait only a moment for the network: in a dead zone the copy appears instead of a spinner.
  const pending = api("getTicket", { secret }, cached ? 12000 : 30000);
  let reply = cached ? await Promise.race([pending, new Promise((done) => setTimeout(() => done(null), 2500))]) : await pending;
  if (!reply) {
    render(cached.data, { state: "checking", savedAt: cached.savedAt, qr: cached.qr });
    reply = await pending;
  }
  showReply(reply, secret, cached);
}

// ---- Offline copy -------------------------------------------------------------------
// Only the ticket page the person already had is kept on their phone (so the QR can still be shown with no signal).
// It never decides who gets in: the scanner and help desk always check the live sheet. Online, the live ticket replaces the copy.

const CACHE_PREFIX = "css_ticket_";
const CACHE_KEEP = 8;
let retryTimer = null;
let retryRunning = false;

function readCache(secret) {
  try {
    const entry = JSON.parse(localStorage.getItem(CACHE_PREFIX + secret) || "null");
    return entry && entry.data && entry.data.ticket ? entry : null;
  } catch (e) { return null; }
}

function writeCache(secret, data, qr) {
  try {
    const keep = { ticket: data.ticket, event: data.event, etransferEmail: data.etransferEmail, orderTotal: data.orderTotal };   // no cancel or feedback: those need a connection
    localStorage.setItem(CACHE_PREFIX + secret, JSON.stringify({ savedAt: Date.now(), data: keep, qr: qr || (readCache(secret) || {}).qr || "" }));
    const all = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => {
      let at = 0; try { at = JSON.parse(localStorage.getItem(k)).savedAt || 0; } catch (e) { /* unreadable: oldest */ }
      return { k, at };
    }).sort((a, b) => b.at - a.at);
    all.slice(CACHE_KEEP).forEach((x) => localStorage.removeItem(x.k));
  } catch (e) { /* storage full or blocked: the page works without a copy */ }
}

function clearCache(secret) { try { localStorage.removeItem(CACHE_PREFIX + secret); } catch (e) { /* fine */ } }

function showReply(reply, secret, cached) {
  if (reply.ok) {
    retryRunning = false;
    render(reply, { state: "live", secret });
    return;
  }
  if (reply.error === "NOT_FOUND") {
    retryRunning = false;
    clearCache(secret);
    $("page").innerHTML = pandaMarkup("error", { sub: T.ticketNotFound });
    return;
  }
  if (cached) render(cached.data, { state: "offline", savedAt: cached.savedAt, qr: cached.qr });
  else $("page").innerHTML = pandaMarkup("error", { sub: reply.error === "NETWORK" ? T.ticketNoSignal : T.error });
  if (reply.error === "NETWORK" || cached) scheduleRetry(secret, cached);
}

/** No signal: try again every 10 seconds, and straight away when the phone says it is back online. */
function scheduleRetry(secret, cached) {
  retryRunning = true;
  clearTimeout(retryTimer);
  const attempt = async () => {
    if (!retryRunning) return;
    clearTimeout(retryTimer);
    const reply = await api("getTicket", { secret }, 12000);
    if (!retryRunning) return;
    if (reply.ok || reply.error === "NOT_FOUND") return showReply(reply, secret, cached);
    retryTimer = setTimeout(attempt, 10000);
  };
  retryTimer = setTimeout(attempt, 10000);
  window.addEventListener("online", () => { if (retryRunning) attempt(); }, { once: true });
}

function render(data, meta = { state: "live" }) {
  const { ticket, event, etransferEmail, orderTotal, canRequestCancel, cancelRequested, canGiveFeedback, feedback } = data;
  const savedTime = meta.savedAt ? new Date(meta.savedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }) : "";
  const banner = meta.state === "offline" ? `<p class="offline-badge">${T.ticketOfflineBadge(savedTime)}</p>`
    : meta.state === "checking" ? `<p class="offline-badge">${T.ticketChecking(savedTime)}</p>` : "";
  document.title = `${T.yourTicket} · ${event.name}`;
  const status = ticket.checkedIn ? "checkedin" : ticket.status;
  // A rubber-stamp look, like the member portal's "VERIFIED" stamp.
  const look = {
    paid: { stamp: T.stampConfirmed, cls: "", note: T.ticketConfirmed },
    checkedin: { stamp: T.stampCheckedIn, cls: "", note: T.ticketCheckedIn },
    awaiting: { stamp: T.stampPending, cls: "pending", note: T.ticketAwaiting(money(orderTotal), etransferEmail, ticket.orderCode) },
    refunded: { stamp: T.stampVoid, cls: "void", note: T.ticketRefunded },
    cancelled: { stamp: T.stampVoid, cls: "void", note: T.ticketCancelled }
  }[status] || { stamp: "", cls: "", note: "" };
  const showQr = ticket.status === "paid";
  $("page").className = "card " + look.cls;   // coloured top edge matches the status

  $("page").innerHTML = `
    <article class="ticket">
      ${banner}
      <div class="ticket-event">${escapeHtml(event.name)}</div>
      <p class="ticket-when">${escapeHtml(formatDate(event.date))}${timeRange(event) ? "<br>" + escapeHtml(timeRange(event)) : ""}${event.location ? `<br>${escapeHtml(event.location)}` : ""}</p>
      <div id="qr" class="qr" aria-label="${T.qrLabel}"></div>
      <div class="ticket-name">${escapeHtml(ticket.name)}</div>
      <div class="ticket-pills"><span class="pill">${escapeHtml(ticket.ticketType)}</span><span class="pill">${escapeHtml(ticket.id)}</span></div>
      <hr class="perforation">
      ${look.stamp ? `<div class="stamp ${look.cls}">${look.stamp}</div>` : ""}
      <p class="ticket-state">${escapeHtml(look.note)}</p>
      ${showQr ? `<p class="muted small">${T.showAtDoor}</p>` : ""}
      ${canGiveFeedback ? `
      <hr class="perforation">
      <section class="feedback" aria-label="${escapeHtml(T.feedbackTitle)}">
        <h2 class="small-heading">${T.feedbackTitle}</h2>
        <p class="muted small">${T.feedbackHint}</p>
        <div class="stars" role="radiogroup" aria-label="${escapeHtml(T.feedbackTitle)}">${[1, 2, 3, 4, 5].map((n) =>
          `<button type="button" class="star${feedback && feedback.rating >= n ? " on" : ""}" data-star="${n}" role="radio" aria-checked="${feedback && feedback.rating === n}" aria-label="${escapeHtml(T.starsLabel(n))}">★</button>`).join("")}</div>
        <textarea id="fb-comment" maxlength="500" rows="3" placeholder="${escapeHtml(T.feedbackPlaceholder)}">${escapeHtml(feedback ? feedback.comment : "")}</textarea>
        <button type="button" class="primary" id="fb-send" ${feedback ? "" : "disabled"}>${T.feedbackSend}</button>
        <p id="fb-note" class="muted small" aria-live="polite">${feedback ? T.feedbackSaved : ""}</p>
      </section>` : ""}
      ${canRequestCancel ? (cancelRequested
        ? `<p class="muted small">${T.cancelAsked}</p><button type="button" class="link" id="cancel-undo">${T.cancelUndo}</button>`
        : `<button type="button" class="link" id="cancel-ask">${T.cancelAsk}</button>`) : ""}
    </article>`;

  const askCancel = async (undo) => {
    if (!undo && !confirm(T.cancelConfirm)) return;
    const reply = await api("requestCancel", { secret: new URLSearchParams(location.search).get("t") || "", undo });
    if (!reply.ok) return alert(reply.message || T.cancelFailed);
    render({ ...data, cancelRequested: reply.cancelRequested });
  };
  let stars = feedback ? feedback.rating : 0;
  document.querySelectorAll(".star").forEach((b) => b.addEventListener("click", () => {
    stars = Number(b.dataset.star);
    document.querySelectorAll(".star").forEach((s) => {
      s.classList.toggle("on", Number(s.dataset.star) <= stars);
      s.setAttribute("aria-checked", String(Number(s.dataset.star) === stars));
    });
    $("fb-send").disabled = false;
  }));
  if ($("fb-send")) $("fb-send").addEventListener("click", async () => {
    $("fb-send").disabled = true;
    $("fb-note").textContent = T.feedbackSaving;
    const reply = await api("submitFeedback", { secret: new URLSearchParams(location.search).get("t") || "", rating: stars, comment: $("fb-comment").value });
    if (!reply.ok) { $("fb-send").disabled = false; $("fb-note").textContent = reply.message || T.feedbackFailed; return; }
    data.feedback = reply.feedback;
    $("fb-note").textContent = T.feedbackSaved;
  });
  if ($("cancel-ask")) $("cancel-ask").addEventListener("click", () => askCancel(false));
  if ($("cancel-undo")) $("cancel-undo").addEventListener("click", () => askCancel(true));

  if (showQr) {
    let drawn = false;
    if (typeof QRCode !== "undefined") {
      try {
        new QRCode($("qr"), { text: location.href, width: 344, height: 344, colorDark: "#2a2520", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
        drawn = true;
      } catch (e) { /* fall back to the saved picture below */ }
    }
    // The QR library could not load (no signal): use the picture saved with the copy
    if (!drawn && meta.qr) $("qr").innerHTML = `<img alt="${escapeHtml(T.qrLabel)}" src="${meta.qr}">`;
    if (meta.state === "live" && meta.secret) {
      const canvas = $("qr").querySelector("canvas");
      const img = $("qr").querySelector("img");
      let picture = "";
      try { picture = canvas ? canvas.toDataURL("image/png") : (img && img.src.startsWith("data:") ? img.src : ""); } catch (e) { /* unsupported: skip */ }
      writeCache(meta.secret, data, picture);
    }
  } else if (meta.state === "live" && meta.secret) {
    writeCache(meta.secret, data, "");
  }
}

// ---- Formatting (same as the event pages) ----------------------------------------

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
}
function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}
function timeRange(e) {
  return [e.startTime, e.endTime].filter(Boolean).map(formatTime).join(" – ");
}
function money(price) {
  return Number(price) === 0 ? T.free : "$" + Number(price).toFixed(Number(price) % 1 ? 2 : 0);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

start();
