// CSS "Find my tickets": tickets.html. Never shows tickets; the server emails the links.

const $ = (id) => document.getElementById(id);

const MEMBER_SITE = "https://member.ucalgarycss.ca/";

async function api(action, details = {}) {
  try {
    const res = await fetch(API_URL, {
      signal: AbortSignal.timeout(30000),
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

function applySite(site) {
  if (!site) return;
  if (site.contactEmail) { $("contact-link").textContent = site.contactEmail; $("contact-link").href = "mailto:" + site.contactEmail; }
  if (/^https:\/\//.test(site.instagramUrl || "")) $("instagram-link").href = site.instagramUrl;
}

function show(text, isError) {
  const out = $("find-result");
  out.textContent = text;
  out.style.color = isError ? "var(--error)" : "";
  out.hidden = !text;
}

async function submit(form, details) {
  const buttons = document.querySelectorAll("#page button[type=submit]");
  const labels = [...buttons].map((b) => b.textContent);
  buttons.forEach((b) => { b.disabled = true; b.textContent = T.findSending; });
  show("");
  const reply = await api("findMyTickets", details);
  buttons.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; });
  if (!reply.ok) return show(reply.error === "NETWORK" || reply.error === "SERVER_ERROR" ? T.error : (reply.message || T.error), true);
  show(reply.maskedEmails && reply.maskedEmails.length ? T.findMasked(reply.maskedEmails.join(", ")) + " " + reply.message : reply.message);
}

// One box to start with. "Forgot" swaps it for the UCID + last name search.
$("forgot").addEventListener("click", () => {
  const forgotten = $("find-ucid").hidden;
  $("find-ucid").hidden = !forgotten;
  $("find-email").hidden = forgotten;
  $("forgot").textContent = forgotten ? T.findBack : T.findForgot;
  show("");
});

$("find-email").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("f-email").value.trim();
  if (!email) return show(T.findNeed, true);
  submit(e.target, { email });
});

$("find-ucid").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ucid = $("f-ucid").value.trim();
  const lastName = $("f-last").value.trim();
  if (!ucid || !lastName) return show(T.findNeed, true);
  // UCID + last name opens the tickets right away. A member goes to their pass and tickets in the member portal;
  // a guest stays here and sees their tickets on this page.
  const buttons = document.querySelectorAll("#page button[type=submit]");
  buttons.forEach((b) => { b.disabled = true; });
  show("");
  const reply = await api("openMyAccess", { ucid, lastName });
  buttons.forEach((b) => { b.disabled = false; });
  if (!reply.ok) return show(reply.error === "NETWORK" || reply.error === "SERVER_ERROR" ? T.error : (reply.message || T.error), true);
  if (reply.kind === "pass") {
    location.href = MEMBER_SITE + `?member=${encodeURIComponent(reply.memberId)}&k=${encodeURIComponent(reply.k)}&view=tickets`;
    return;
  }
  await showMyTickets({ ucid: reply.ucid, k: reply.k });
});

// ---- A guest's tickets, on this site ---------------------------------------------------------
// Opened from the link in the "Find my tickets" email (?e=EMAIL&k=KEY) or by UCID + last name. The private key is kept on
// this device and taken out of the address bar, so the next visit opens straight to the tickets.

const SAVED_LINK = "CSS_MY_TICKETS_LINK";

function savedLink() {
  try { return JSON.parse(localStorage.getItem(SAVED_LINK) || "null"); } catch (e) { return null; }
}

function forgetLink() {
  try { localStorage.removeItem(SAVED_LINK); } catch (e) { /* fine */ }
}

function formatWhen(e) {
  const day = e.date ? new Date(e.date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) : "";
  const time = e.startTime ? (() => { const [h, m] = e.startTime.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }); })() : "";
  return [day, time, e.location].filter(Boolean).join(" · ");
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** `who` = { email | ucid, k }. Shows the list and remembers the link; returns false when the link no longer works. */
async function showMyTickets(who) {
  const reply = await api("myTickets", who);
  if (!reply.ok) {
    if (reply.error === "NETWORK" || reply.error === "SERVER_ERROR") { show(T.error, true); return false; }
    forgetLink();
    show(T.myTicketsExpired, true);
    return false;
  }
  try { localStorage.setItem(SAVED_LINK, JSON.stringify(who)); } catch (e) { /* fine */ }
  $("my-hello").textContent = T.myTicketsHello(reply.name);
  $("my-cards").innerHTML = reply.tickets.length ? reply.tickets.map((t) => {
    const state = t.status === "paid" ? (t.checkedIn ? T.myTicketsCheckedIn : T.myTicketsPaid) : T.myTicketsWaiting(t.orderCode);
    return `<li><span class="my-ticket"><strong>${escapeText(t.event.name)}</strong>
      <span class="when">${escapeText(formatWhen(t.event))}</span><br>
      ${escapeText(t.name)} · ${escapeText(t.ticketType)}<br>
      <a class="ticket-open" href="ticket.html?t=${encodeURIComponent(t.secret)}">${T.openTicket}</a></span>
      <span class="my-ticket"><span class="state ${t.status === "paid" ? "" : "wait"}">${escapeText(state)}</span></span></li>`;
  }).join("") : `<li class="muted">${T.myTicketsEmpty}</li>`;
  $("my-list").hidden = false;
  $("find-block").hidden = true;
  return true;
}

$("my-forget").addEventListener("click", () => {
  forgetLink();
  $("my-list").hidden = true;
  $("find-block").hidden = false;
});

async function openFromLink() {
  const params = new URLSearchParams(location.search);
  const k = (params.get("k") || "").trim();
  const email = (params.get("e") || "").trim().toLowerCase();
  const ucid = (params.get("u") || "").replace(/\D/g, "");
  if (k && (email || ucid)) {
    history.replaceState(null, "", location.pathname);   // the key does not stay in the address bar
    await showMyTickets(email ? { email, k } : { ucid, k });
    return;
  }
  const saved = savedLink();
  if (saved && saved.k && (saved.email || saved.ucid)) await showMyTickets(saved);
}

document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
$("contact-link").textContent = CONTACT_EMAIL;
$("contact-link").href = "mailto:" + CONTACT_EMAIL;
$("instagram-link").href = INSTAGRAM_URL;

openFromLink();
