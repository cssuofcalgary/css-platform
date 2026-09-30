// CSS ticket page: ticket.html?t=<secret>. Shows the person's QR code for the door.
// The QR code holds this page's own address, so any phone camera (or the CSS scanner) can read it.

const $ = (id) => document.getElementById(id);

async function api(action, details = {}) {
  try {
    const res = await fetch(API_URL, {
      signal: AbortSignal.timeout(30000),   // never stay on "Loading…" forever
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

  const secret = new URLSearchParams(location.search).get("t") || "";
  const reply = await api("getTicket", { secret });
  if (!reply.ok) {
    $("page").innerHTML = `<p class="muted center">${reply.error === "NOT_FOUND" ? T.ticketNotFound : T.error}</p>`;
    return;
  }
  render(reply);
}

function render({ ticket, event, etransferEmail, orderTotal }) {
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
      <div class="ticket-event">${escapeHtml(event.name)}</div>
      <p class="ticket-when">${escapeHtml(formatDate(event.date))}${timeRange(event) ? "<br>" + escapeHtml(timeRange(event)) : ""}${event.location ? `<br>${escapeHtml(event.location)}` : ""}</p>
      <div id="qr" class="qr" aria-label="${T.qrLabel}"></div>
      <div class="ticket-name">${escapeHtml(ticket.name)}</div>
      <div class="ticket-pills"><span class="pill">${escapeHtml(ticket.ticketType)}</span><span class="pill">${escapeHtml(ticket.id)}</span></div>
      <hr class="perforation">
      ${look.stamp ? `<div class="stamp ${look.cls}">${look.stamp}</div>` : ""}
      <p class="ticket-state">${escapeHtml(look.note)}</p>
      ${showQr ? `<p class="muted small">${T.showAtDoor}</p>` : ""}
    </article>`;

  if (showQr) {
    new QRCode($("qr"), { text: location.href, width: 344, height: 344, colorDark: "#2a2520", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
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
