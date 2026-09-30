// CSS ticket page: ticket.html?t=<secret>. Shows the person's QR code for the door.
// The QR code holds this page's own address, so any phone camera (or the CSS scanner) can read it.

const $ = (id) => document.getElementById(id);

async function api(action, details = {}) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...details })
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: "NETWORK" };
  }
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
  const banner = {
    paid: `<div class="ticket-state good">${T.ticketConfirmed}</div>`,
    checkedin: `<div class="ticket-state good">${T.ticketCheckedIn}</div>`,
    awaiting: `<div class="ticket-state warn">${T.ticketAwaiting(money(orderTotal), etransferEmail, ticket.orderCode)}</div>`,
    refunded: `<div class="ticket-state bad">${T.ticketRefunded}</div>`,
    cancelled: `<div class="ticket-state bad">${T.ticketCancelled}</div>`
  }[status] || "";
  const showQr = ticket.status === "paid";

  $("page").innerHTML = `
    <article class="ticket">
      ${banner}
      <div class="ticket-card ${showQr ? "" : "dimmed"}">
        <div class="ticket-event">${escapeHtml(event.name)}</div>
        <div class="muted">${escapeHtml(formatDate(event.date))}${timeRange(event) ? " · " + escapeHtml(timeRange(event)) : ""}</div>
        ${event.location ? `<div class="muted">${escapeHtml(event.location)}</div>` : ""}
        <div id="qr" class="qr" aria-label="${T.qrLabel}"></div>
        <div class="ticket-name">${escapeHtml(ticket.name)}</div>
        <div class="muted">${escapeHtml(ticket.ticketType)} · <span class="mono">${escapeHtml(ticket.id)}</span></div>
      </div>
      ${showQr ? `<p class="muted small center">${T.showAtDoor}</p>` : ""}
    </article>`;

  if (showQr) {
    new QRCode($("qr"), { text: location.href, width: 240, height: 240, colorDark: "#1c1917", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
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
