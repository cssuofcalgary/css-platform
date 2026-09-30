// CSS public event pages: the list of upcoming events, and one page per event.
// ?e=<event-slug> shows one event; no ?e shows the list.

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

// ---- Pages ------------------------------------------------------------------

async function showEventList() {
  const reply = await api("publicEvents");
  if (!reply.ok) return showMessage(T.error);
  document.title = "CSS Events";
  $("page").innerHTML = `
    <h1 class="page-title">${T.upcoming}</h1>
    ${reply.events.length ? `<div class="event-grid">${reply.events.map(eventCard).join("")}</div>`
                          : `<p class="muted">${T.noUpcoming}</p>`}`;
}

function eventCard(e) {
  return `
    <a class="event-card" href="?e=${encodeURIComponent(e.slug)}">
      ${e.imageUrl ? `<img src="${escapeAttr(e.imageUrl)}" alt="" loading="lazy">` : `<div class="image-fallback">${escapeHtml(e.name)}</div>`}
      <div class="event-card-body">
        <div class="event-card-date">${escapeHtml(formatDate(e.date))}</div>
        <div class="event-card-name">${escapeHtml(e.name)}</div>
        ${e.location ? `<div class="muted small">${escapeHtml(e.location)}</div>` : ""}
      </div>
    </a>`;
}

async function showEvent(slug) {
  const reply = await api("publicEvent", { slug });
  if (!reply.ok) return showMessage(reply.error === "NOT_FOUND" ? T.notFound : T.error, true);
  const e = reply.event;
  document.title = `${e.name} · CSS`;

  $("page").innerHTML = `
    <a class="back" href="./">${T.allEvents}</a>
    <article class="event">
      ${e.imageUrl ? `<img class="hero" src="${escapeAttr(e.imageUrl)}" alt="">` : ""}
      <h1 class="event-name">${escapeHtml(e.name)}</h1>

      <dl class="facts">
        <div><dt>${T.when}</dt><dd>${escapeHtml(formatDate(e.date))}${timeRange(e) ? `<br>${escapeHtml(timeRange(e))}` : ""}</dd></div>
        ${e.location ? `<div><dt>${T.where}</dt><dd>${escapeHtml(e.location)}</dd></div>` : ""}
      </dl>

      <section class="tickets">
        <h2>${T.tickets}</h2>
        <ul>${e.ticketTypes.map((t) => `
          <li><span>${escapeHtml(t.name)}${t.needsMembership ? ` <small class="muted">(${T.membersOnly})</small>` : ""}</span>
              <strong>${money(t.price)}</strong></li>`).join("")}
        </ul>
        ${registerBlock(e)}
      </section>

      ${e.description ? `<section class="description">${paragraphs(e.description)}</section>` : ""}
    </article>`;
  currentEvent = e;
  const open = $("open-register");
  if (open) open.addEventListener("click", () => showRegisterForm(e));
}

function registerBlock(e) {
  if (e.soldOut) return `<p class="notice">${T.soldOut}</p>`;
  if (!e.registrationOpen) return `<p class="notice">${T.closed}</p>`;
  return `
    ${e.spotsLeft !== null && e.spotsLeft <= 20 ? `<p class="spots">${T.spotsLeft(e.spotsLeft)}</p>` : ""}
    <button class="register" id="open-register">${T.register}</button>
    <p class="muted small">${T.payNote}</p>`;
}

function showMessage(text, withBack) {
  $("page").innerHTML = `${withBack ? `<a class="back" href="./">${T.allEvents}</a>` : ""}<p class="muted center">${escapeHtml(text)}</p>`;
}

// ---- Registration -------------------------------------------------------------

let currentEvent = null;
let guestCount = 0;

function showRegisterForm(e) {
  guestCount = 0;
  const hasPrice = e.ticketTypes.some((t) => Number(t.price) > 0);
  $("page").innerHTML = `
    <button class="back link-button" id="back-to-event">${T.cancel}</button>
    <h1 class="page-title">${escapeHtml(e.name)}</h1>
    <form id="register-form" class="register-form" novalidate>
      <section class="person card-block" data-person="0">
        <h2>${T.yourDetails}</h2>
        ${personFields(e, 0)}
      </section>

      <div id="guests"></div>

      <section class="card-block">
        <h2>${T.payingForOthers}</h2>
        <button type="button" class="secondary-button" id="add-guest">${T.addGuest}</button>
      </section>

      ${hasPrice ? `
      <section class="card-block">
        <label for="etransfer-name">${T.etransferName}</label>
        <input id="etransfer-name" autocomplete="off" maxlength="80">
        <p class="hint">${T.etransferNameHint}</p>
      </section>` : ""}

      <input type="text" name="website" id="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

      <div class="total-row"><span>${T.total}</span><strong id="total">$0</strong></div>
      <p id="form-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="register" id="submit">${T.submit}</button>
      <p class="muted small center">${T.privacyNote}</p>
    </form>`;

  $("back-to-event").addEventListener("click", () => showEvent(e.slug));
  $("add-guest").addEventListener("click", addGuest);
  $("register-form").addEventListener("change", onFormChange);
  $("register-form").addEventListener("click", onFormClick);
  $("register-form").addEventListener("submit", onSubmit);
  updateMemberFields();
  updateTotal();
  window.scrollTo(0, 0);
}

function personFields(e, i) {
  const id = (name) => `p${i}-${name}`;
  const single = e.ticketTypes.length === 1;
  return `
    <label for="${id("name")}">${T.fullName} <span class="req">*</span></label>
    <input id="${id("name")}" data-f="name" autocomplete="${i ? "off" : "name"}" maxlength="80" required>

    <label for="${id("email")}">${T.email} <span class="req">*</span></label>
    <input id="${id("email")}" data-f="email" type="email" inputmode="email" autocomplete="${i ? "off" : "email"}" maxlength="120" required>
    <p class="hint">${i ? T.guestEmailHint : T.emailHint}</p>

    <label for="${id("ucid")}">${T.ucid}</label>
    <input id="${id("ucid")}" data-f="ucid" inputmode="numeric" maxlength="12">
    <p class="hint">${T.ucidHint}</p>

    <fieldset class="ticket-choice">
      <legend>${T.ticket} <span class="req">*</span></legend>
      ${e.ticketTypes.map((t) => `
        <label class="radio">
          <input type="radio" name="${id("type")}" data-f="ticketTypeId" value="${escapeAttr(t.id)}" ${single ? "checked" : ""}>
          <span>${escapeHtml(t.name)}${t.needsMembership ? ` <small class="muted">(${T.membersOnly})</small>` : ""}</span>
          <strong>${money(t.price)}</strong>
        </label>`).join("")}
    </fieldset>

    <div class="member-fields" hidden>
      <label for="${id("member")}">${T.memberId}</label>
      <input id="${id("member")}" data-f="memberId" autocomplete="off" maxlength="20" placeholder="CSS…">
      <p class="hint">${T.memberCheckNote}</p>
    </div>

    ${e.questions.map((q) => `
      <label for="${id(q.id)}">${escapeHtml(q.label)} ${q.required ? `<span class="req">*</span>` : ""}</label>
      ${q.type === "choice"
        ? `<select id="${id(q.id)}" data-q="${escapeAttr(q.id)}"><option value="">${T.choose}</option>${q.options.map((o) => `<option>${escapeHtml(o)}</option>`).join("")}</select>`
        : `<input id="${id(q.id)}" data-q="${escapeAttr(q.id)}" maxlength="300">`}`).join("")}`;
}

function addGuest() {
  guestCount++;
  const section = document.createElement("section");
  section.className = "person card-block";
  section.dataset.person = String(guestCount);
  section.innerHTML = `
    <div class="row-between"><h2></h2>
      <button type="button" class="link-button" data-remove-guest>${T.removeGuest}</button></div>
    ${personFields(currentEvent, guestCount)}`;
  $("guests").appendChild(section);
  renumberGuests();
  updateMemberFields();
  updateTotal();
  section.querySelector("input").focus();
}

function renumberGuests() {
  document.querySelectorAll("#guests .person").forEach((s, i) => { s.querySelector("h2").textContent = T.guestTitle(i + 1); });
}

function onFormClick(ev) {
  const remove = ev.target.closest("[data-remove-guest]");
  if (!remove) return;
  remove.closest(".person").remove();
  renumberGuests();
  updateTotal();
}

function onFormChange() {
  updateMemberFields();
  updateTotal();
}

function chosenType(section) {
  const picked = section.querySelector('input[data-f="ticketTypeId"]:checked');
  return picked ? currentEvent.ticketTypes.find((t) => t.id === picked.value) : null;
}

function updateMemberFields() {
  document.querySelectorAll("#register-form .person").forEach((s) => {
    const type = chosenType(s);
    s.querySelector(".member-fields").hidden = !(type && type.needsMembership);
  });
}

function updateTotal() {
  let total = 0;
  document.querySelectorAll("#register-form .person").forEach((s) => {
    const type = chosenType(s);
    if (type) total += Number(type.price) || 0;
  });
  $("total").textContent = money(total);
}

function readPeople() {
  return [...document.querySelectorAll("#register-form .person")].map((s) => {
    const person = { answers: {} };
    s.querySelectorAll("[data-f]").forEach((el) => {
      if (el.type === "radio") { if (el.checked) person.ticketTypeId = el.value; }
      else person[el.dataset.f] = el.value.trim();
    });
    s.querySelectorAll("[data-q]").forEach((el) => { person.answers[el.dataset.q] = el.value.trim(); });
    return person;
  });
}

/** Quick checks in the browser so people see problems before sending. The server checks again. */
function firstProblem(people) {
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const who = i === 0 ? "" : ` (${T.guestTitle(i)})`;
    if (!p.name) return T.fullName + who;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email || "")) return T.email + who;
    if (!p.ticketTypeId) return T.ticket + who;
    const missing = currentEvent.questions.find((q) => q.required && !p.answers[q.id]);
    if (missing) return missing.label + who;
  }
  return "";
}

async function onSubmit(ev) {
  ev.preventDefault();
  const people = readPeople();
  const problem = firstProblem(people);
  const error = $("form-error");
  if (problem) { error.textContent = T.pleaseFill(problem); error.hidden = false; return; }
  error.hidden = true;

  const button = $("submit");
  button.disabled = true;
  button.textContent = T.submitting;
  const reply = await api("register", {
    slug: currentEvent.slug,
    people,
    etransferName: $("etransfer-name") ? $("etransfer-name").value.trim() : "",
    website: $("website").value
  });
  button.disabled = false;
  button.textContent = T.submit;

  if (!reply.ok) {
    error.textContent = reply.error === "NETWORK" ? T.error : (reply.message || T.error);
    error.hidden = false;
    return;
  }
  showPaymentScreen(reply);
}

function showPaymentScreen(reply) {
  const free = reply.order.status === "paid";
  const flagged = reply.tickets.filter((t) => t.flag && t.flag.indexOf("Member price") === 0);
  $("page").innerHTML = `
    <article class="done">
      <h1 class="page-title">${free ? T.registeredFree : T.almostDone}</h1>
      ${free ? `<p>${T.freeNote}</p>` : `
        <p class="lead">${T.sendEtransfer}</p>
        <div class="pay-box">
          <div class="pay-row"><span>${T.amount}</span><div><strong class="big">${money(reply.order.total)}</strong> <small class="muted">${T.exactly}</small></div></div>
          <div class="pay-row"><span>${T.sendTo}</span><div><strong>${escapeHtml(reply.etransferEmail)}</strong>
            <button class="copy" data-copy="${escapeAttr(reply.etransferEmail)}">${T.copy}</button></div></div>
          <div class="pay-row"><span>${T.message}</span><div><strong class="code">${escapeHtml(reply.order.code)}</strong>
            <button class="copy" data-copy="${escapeAttr(reply.order.code)}">${T.copy}</button></div></div>
        </div>
        <p class="muted small">${T.noMessageNote}</p>
        <p>${T.confirmNote}</p>`}

      <h2 class="small-heading">${T.ticketsHeading}</h2>
      <ul class="ticket-list">${reply.tickets.map((t) => `
        <li><span>${escapeHtml(t.name)} · ${escapeHtml(t.ticketType)}</span><strong>${money(t.price)}</strong></li>`).join("")}
      </ul>
      ${flagged.map((t) => `<p class="flag-note">${escapeHtml(T.flagNote(t.name))}</p>`).join("")}
      ${reply.emailSent ? `<p class="muted small">${T.emailedCopy}</p>` : ""}
      <p class="muted small">${T.screenshotTip}</p>
    </article>`;

  document.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = T.copied;
      setTimeout(() => { b.textContent = T.copy; }, 1500);
    } catch (e) { /* copying not allowed: they can still read it */ }
  }));
  window.scrollTo(0, 0);
}

// ---- Formatting ---------------------------------------------------------------

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
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

function paragraphs(text) {
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const escapeAttr = escapeHtml;

// ---- Start --------------------------------------------------------------------

function start() {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
  $("contact-link").textContent = CONTACT_EMAIL;
  $("contact-link").href = "mailto:" + CONTACT_EMAIL;
  $("instagram-link").href = INSTAGRAM_URL;

  const slug = new URLSearchParams(location.search).get("e");
  slug ? showEvent(slug) : showEventList();
}

start();
