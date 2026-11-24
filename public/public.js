// CSS public event pages: the list of upcoming events, and one page per event.
// ?e=<event-slug> shows one event; no ?e shows the list.

const $ = (id) => document.getElementById(id);

async function api(action, details = {}) {
  if (new URLSearchParams(location.hash.slice(1)).has("preview")) return { ok: false, error: "PREVIEW" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(API_URL, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...details })
    });
    const data = await res.json();
    if (data && data.site) applySite(data.site);
    return data;
  } catch (err) {
    return { ok: false, error: "NETWORK" };
  } finally { clearTimeout(timer); }
}

/** Contact email + Instagram come from the Exec Portal's Settings (config.js is only the fallback). */
function applySite(site) {
  if (!site) return;
  if (site.contactEmail) { $("contact-link").textContent = site.contactEmail; $("contact-link").href = "mailto:" + site.contactEmail; }
  if (/^https:\/\//.test(site.instagramUrl || "")) $("instagram-link").href = site.instagramUrl;
}

// ---- Pages ------------------------------------------------------------------

/** An error screen with the confused panda. `retry` adds a "Try again" button; `withBack` adds the link back to all events. */
function showPandaError(message, retry, withBack) {
  $("page").innerHTML = (withBack ? `<a class="back" href="./">${T.allEvents}</a>` : "") + pandaMarkup("error", { sub: message, retry: !!retry });
  const button = $("page").querySelector(".pl-retry");
  if (button && retry) button.addEventListener("click", retry);
}

async function showEventList() {
  mountPanda($("page"), "loading");
  const reply = await api("publicEvents");
  if (!reply.ok) return showPandaError(T.error, showEventList);
  document.title = "CSS Events";
  $("page").innerHTML = `
    <h1 class="page-title">${T.upcoming}</h1>
    ${reply.events.length ? `<div class="event-grid">${reply.events.map(eventCard).join("")}</div>`
                          : `<p class="muted">${T.noUpcoming}</p>`}`;
}

function eventCard(e) {
  return `
    <a class="event-card" href="?e=${encodeURIComponent(e.slug)}">
      ${e.imageUrl ? `<img src="${escapeAttr(e.imageUrl)}" alt="" loading="lazy" data-name="${escapeAttr(e.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'image-fallback', textContent: this.dataset.name }))">` : `<div class="image-fallback">${escapeHtml(e.name)}</div>`}
      <div class="event-card-body">
        <div class="event-card-date">${escapeHtml(formatDate(e.date))}</div>
        <div class="event-card-name">${escapeHtml(e.name)}</div>
        ${e.location ? `<div class="muted small">${escapeHtml(e.location)}</div>` : ""}
      </div>
    </a>`;
}

async function showEvent(slug) {
  mountPanda($("page"), "loading");
  const reply = await api("publicEvent", { slug });
  if (!reply.ok) return showPandaError(reply.error === "NOT_FOUND" ? T.notFound : T.error, reply.error === "NOT_FOUND" ? null : () => showEvent(slug), true);
  const e = reply.event;
  renderEvent(e);
}

function renderEvent(e) {
  document.title = `${e.name} · CSS`;

  $("page").innerHTML = `
    <a class="back" href="./">${T.allEvents}</a>
    <article class="event">
      ${eventAnnouncement(e)}
      ${e.imageUrl ? `<img class="hero" src="${escapeAttr(e.imageUrl)}" alt="" onerror="this.remove()">` : ""}
      <h1 class="event-name">${escapeHtml(e.name)}</h1>
      ${e.previewLabel ? `<p class="notice">${escapeHtml(e.previewLabel)}</p>` : ""}

      <dl class="facts">
        <div><dt>${T.when}</dt><dd>${escapeHtml(formatDate(e.date))}${timeRange(e) ? `<br>${escapeHtml(timeRange(e))}` : ""}${e.registrationCloses ? `<br>${escapeHtml(T.closesAt(formatDateTime(e.registrationCloses)))}` : ""}</dd></div>
        ${e.location ? `<div><dt>${T.where}</dt><dd>${escapeHtml(e.location)}</dd></div>` : ""}
      </dl>
      ${e.description ? `<section class="description">${paragraphs(e.description)}</section>` : ""}
      <hr class="perforation">

      <section class="tickets">
        <h2>${T.tickets}</h2>
        <ul>${e.ticketTypes.map((t) => `
          <li><span>${escapeHtml(t.name)}${t.needsMembership ? ` <small class="muted">(${T.membersOnly})</small>` : ""}</span>
              <strong>${money(t.price)}</strong></li>`).join("")}
        </ul>
        ${registerBlock(e)}
      </section>

    </article>`;
  currentEvent = e;
  const open = $("open-register");
  if (open) open.addEventListener("click", () => showRegisterForm(e));
  const wl = $("open-waitlist");
  if (wl) wl.addEventListener("click", () => showWaitlistForm(e));
}

/** Organizer text is plain text, escaped before displaying its paragraphs. */
function eventAnnouncement(e) {
  const text = String(e.announcement || "").trim();
  return text ? `<section class="important-note"><h2>${T.announcementTitle}</h2>${paragraphs(text)}</section>` : "";
}

function registerBlock(e) {
  if (e.previewLabel) return `<button class="register" disabled>${T.register}</button>`;
  if (e.soldOut) return `<p class="notice">${T.soldOut}</p>${e.waitlistOpen ? `<button class="register" id="open-waitlist">${T.waitlistJoin}</button>` : ""}`;
  if (!e.registrationOpen) return `<p class="notice">${T.closed}</p>`;
  return `
    ${e.spotsLeft !== null && e.spotsLeft <= 20 ? `<p class="spots">${T.spotsLeft(e.spotsLeft)}</p>` : ""}
    ${e.ticketTypes.some((t) => Number(t.price) > 0) ? `<p class="muted small">${T.payNote}</p>` : ""}
    <button class="register" id="open-register">${T.register}</button>`;
}

function formatDateTime(local) {
  const [date, time] = String(local).split("T");
  return `${new Date(date + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}, ${formatTime(time || "23:59")}`;
}

function showMessage(text, withBack) {
  $("page").innerHTML = `${withBack ? `<a class="back" href="./">${T.allEvents}</a>` : ""}<p class="muted center">${escapeHtml(text)}</p>`;
}

// ---- Registration -------------------------------------------------------------

let currentEvent = null;
let guestCount = 0;
// What someone typed on the sign-up form, kept while they look back at the event page (this visit only; nothing is sent).
let registerDraft = null;   // { slug, shape, guestCount, nodes }

/** Ticket types and questions as one string: a draft is only put back if the event's form still looks the same. */
function formShape(e) {
  return JSON.stringify([e.ticketTypes, e.questions]);
}

function backToEvent(e) {
  registerDraft = { slug: e.slug, shape: formShape(e), guestCount, nodes: [...$("page").childNodes] };
  showEvent(e.slug);
}

function showRegisterForm(e, fresh) {
  if (!fresh && registerDraft && registerDraft.slug === e.slug && registerDraft.shape === formShape(e)) {
    $("page").replaceChildren(...registerDraft.nodes);   // the same boxes, with everything still typed in them
    guestCount = registerDraft.guestCount;
    registerDraft = null;
    const announcement = $("registration-announcement");
    if (announcement) announcement.innerHTML = eventAnnouncement(e);
    updateMemberFields();
    updateQuestions();
    updateTotal();
    window.scrollTo(0, 0);
    return;
  }
  registerDraft = null;
  guestCount = 0;
  const hasPrice = e.ticketTypes.some((t) => Number(t.price) > 0);
  $("page").innerHTML = `
    <div class="row-between form-top">
      <button type="button" class="back link-button" id="back-to-event">${T.cancel}</button>
      <button type="button" class="link-button" id="clear-form">${T.clearForm}</button>
    </div>
    <div id="registration-announcement">${eventAnnouncement(e)}</div>
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
      <section class="card-block" id="etransfer-block">
        <label for="etransfer-name">${T.etransferName}</label>
        <input id="etransfer-name" autocomplete="off" maxlength="80">
      </section>` : ""}

      <input type="text" name="website" id="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

      <div class="total-row"><span>${T.total}</span><strong id="total">$0</strong></div>
      <p id="form-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="register" id="submit">${T.submit}</button>
    </form>`;

  $("back-to-event").addEventListener("click", () => backToEvent(e));
  $("clear-form").addEventListener("click", async () => { if (await askConfirm(T.clearConfirm)) showRegisterForm(e, true); });
  $("add-guest").addEventListener("click", addGuest);
  $("register-form").addEventListener("change", onFormChange);
  $("register-form").addEventListener("input", updateMemberFields);
  $("register-form").addEventListener("click", onFormClick);
  $("register-form").addEventListener("submit", onSubmit);
  updateMemberFields();
  updateQuestions();
  updateTotal();
  window.scrollTo(0, 0);
}

/** A small yes/no box drawn in the page (the browser's own confirm() can stop appearing). */
function askConfirm(message) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "ask";
    dialog.innerHTML = `<p></p><div class="ask-buttons"><button type="button" class="register" data-yes>${T.clearYes}</button><button type="button" class="link-button" data-no>${T.clearKeep}</button></div>`;
    dialog.querySelector("p").textContent = message;
    const done = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
    dialog.querySelector("[data-yes]").addEventListener("click", () => done(true));
    dialog.querySelector("[data-no]").addEventListener("click", () => done(false));
    dialog.addEventListener("cancel", (ev) => { ev.preventDefault(); done(false); });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

// ---- Waitlist (event is full) --------------------------------------------------

function showWaitlistForm(e) {
  guestCount = 0;
  $("page").innerHTML = `
    <button class="back link-button" id="back-to-event">${T.cancel}</button>
    ${eventAnnouncement(e)}
    <h1 class="page-title">${escapeHtml(e.name)}</h1>
    <p class="lead">${T.waitlistIntro}</p>
    <form id="register-form" class="register-form" novalidate>
      <section class="person card-block" data-person="0">
        <h2>${T.yourDetails}</h2>
        ${personFields(e, 0)}
      </section>
      <span id="total" hidden></span>
      <input type="text" name="website" id="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p id="form-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="register" id="submit">${T.waitlistSubmit}</button>
    </form>`;
  $("back-to-event").addEventListener("click", () => showEvent(e.slug));
  $("register-form").addEventListener("change", onFormChange);
  $("register-form").addEventListener("input", updateMemberFields);
  $("register-form").addEventListener("submit", onWaitlistSubmit);
  updateMemberFields();
  updateQuestions();
  window.scrollTo(0, 0);
}

async function onWaitlistSubmit(ev) {
  ev.preventDefault();
  const button = $("submit");
  if (button.disabled) return;
  const people = readPeople();
  const problem = firstProblem(people);
  const error = $("form-error");
  if (problem) { error.textContent = problem; error.hidden = false; return; }
  error.hidden = true;
  button.disabled = true;
  button.textContent = T.submitting;
  let reply;
  for (let attempt = 1; attempt <= 3; attempt++) {   // joining twice is harmless: the second try just says "already on the list"
    reply = await api("joinWaitlist", { slug: currentEvent.slug, person: people[0], website: $("website").value });
    if (reply.ok || !["BUSY", "TEMPORARY", "NETWORK"].includes(reply.error) || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  button.disabled = false;
  button.textContent = T.waitlistSubmit;
  if (!reply.ok) { error.textContent = reply.error === "NETWORK" ? T.error : (reply.message || T.error); error.hidden = false; return; }
  $("page").innerHTML = `
    <article class="done">
      ${pandaImg("sleep")}
      <h1 class="page-title">${T.waitlistDoneTitle}</h1>
      <p class="lead">${reply.already ? T.waitlistAlready : T.waitlistDoneNote}</p>
      <a class="back" href="./">${T.allEvents}</a>
    </article>`;
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

    <label for="${id("ucid")}">${T.ucid} <span class="req" data-identity-required>*</span></label>
    <input id="${id("ucid")}" data-f="ucid" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" required>

    <fieldset class="ticket-choice">
      <legend>${T.ticket} <span class="req">*</span></legend>
      ${e.ticketTypes.map((t) => `
        <label class="radio">
          <input type="radio" name="${id("type")}" data-f="ticketTypeId" value="${escapeAttr(t.id)}" ${single ? "checked" : ""}>
          <span>${escapeHtml(t.name)}${t.needsMembership ? ` <small class="muted">(${T.membersOnly})</small>` : ""}</span>
          <strong>${money(t.price)}</strong>
        </label>`).join("")}
    </fieldset>

    <div class="member-fields">
      <label for="${id("member")}">${T.memberId}</label>
      <input id="${id("member")}" data-f="memberId" autocomplete="off" maxlength="20" placeholder="CSS…">
    </div>

    ${e.questions.map((q) => `
      <div class="question" data-question="${escapeAttr(q.id)}">
      <label for="${id(q.id)}">${escapeHtml(q.label)} ${q.required ? `<span class="req">*</span>` : ""}</label>
      ${q.type === "choice"
        ? `<select id="${id(q.id)}" data-q="${escapeAttr(q.id)}"><option value="">${T.choose}</option>${q.options.map((o) => `<option>${escapeHtml(o)}</option>`).join("")}</select>`
        : `<input id="${id(q.id)}" data-q="${escapeAttr(q.id)}" maxlength="300">`}
      </div>`).join("")}

    <label for="${id("note")}">${T.registrationNote}</label>
    <textarea id="${id("note")}" data-f="note" maxlength="1000" rows="3"></textarea>`;
}

/** A question can be limited to some ticket types (forTickets). None listed = it is for every ticket. */
function questionApplies(q, ticketTypeId) {
  const only = Array.isArray(q.forTickets) ? q.forTickets.filter(Boolean) : [];
  return !only.length || (!!ticketTypeId && only.includes(ticketTypeId));
}

/** Each person sees only the questions for the ticket they picked. A question that disappears loses its answer. */
function updateQuestions() {
  document.querySelectorAll("#register-form .person").forEach((s) => {
    const type = chosenType(s);
    s.querySelectorAll("[data-question]").forEach((box) => {
      const q = currentEvent.questions.find((x) => x.id === box.dataset.question);
      const show = !q || questionApplies(q, type ? type.id : "");
      box.hidden = !show;
      if (!show) box.querySelectorAll("[data-q]").forEach((el) => { el.value = ""; });
    });
  });
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
  updateQuestions();
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
  updateQuestions();
  updateTotal();
}

function chosenType(section) {
  const picked = section.querySelector('input[data-f="ticketTypeId"]:checked');
  return picked ? currentEvent.ticketTypes.find((t) => t.id === picked.value) : null;
}

function updateMemberFields() {
  document.querySelectorAll("#register-form .person").forEach((s) => {
    const type = chosenType(s);
    const note = s.querySelector("[data-member-note]");
    if (note) note.hidden = !(type && type.needsMembership);
    const needsUcid = !s.querySelector('[data-f="memberId"]').value.trim();
    s.querySelector('[data-f="ucid"]').required = needsUcid;
    s.querySelector("[data-identity-required]").hidden = !needsUcid;
  });
}

function updateTotal() {
  let total = 0;
  let allChosen = true;
  document.querySelectorAll("#register-form .person").forEach((s) => {
    const type = chosenType(s);
    if (type) total += Number(type.price) || 0;
    else allChosen = false;
  });
  // Until everyone has a ticket the total isn't known yet: say so instead of "Free"
  $("total").textContent = allChosen ? money(total) : T.chooseTickets;
  $("total").classList.toggle("total-pending", !allChosen);
  // Nothing owed: no e-transfer details to ask for, and the button says it is just a registration
  if ($("etransfer-block")) $("etransfer-block").hidden = total === 0;
  const button = $("submit");
  if ($("etransfer-block") && button && !button.disabled) button.textContent = total > 0 ? T.submitPaid : allChosen ? T.submitFree : T.submit;   // only on the registration form of an event that charges
}

function readPeople() {
  return [...document.querySelectorAll("#register-form .person")].map((s) => {
    const person = { answers: {} };
    s.querySelectorAll("[data-f]").forEach((el) => {
      if (el.type === "radio") { if (el.checked) person.ticketTypeId = el.value; }
      else person[el.dataset.f] = el.value.trim();
    });
    s.querySelectorAll("[data-q]").forEach((el) => {   // answers only to the questions for this person's ticket
      const q = currentEvent.questions.find((x) => x.id === el.dataset.q);
      if (!q || questionApplies(q, person.ticketTypeId)) person.answers[el.dataset.q] = el.value.trim();
    });
    return person;
  });
}

/** Quick checks in the browser so people see problems before sending. The server checks again. */
function firstProblem(people) {
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const who = i === 0 ? "" : ` (${T.guestTitle(i)})`;
    if (!p.name) return T.pleaseFill(T.fullName + who);
    if (String(p.email || "").length > 120 || !/^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/i.test(p.email || "")) return T.emailInvalid + who;
    const email = String(p.email).toLowerCase();
    const split = email.lastIndexOf("@");
    const correctedDomain = EMAIL_DOMAIN_TYPOS[email.slice(split + 1)];
    if (correctedDomain) return T.emailTypo(email.slice(0, split + 1) + correctedDomain) + who;
    if (!p.ucid && !p.memberId) return T.identityRequired + who;
    if (p.ucid && !/^[0-9]{8}$/.test(p.ucid)) return T.ucidInvalid + who;
    if (!p.ticketTypeId) return T.pleaseFill(T.ticket + who);
    const missing = currentEvent.questions.find((q) => q.required && questionApplies(q, p.ticketTypeId) && !(p.answers || {})[q.id]);
    if (missing) return T.pleaseFill(missing.label + who);
  }
  return "";
}

// Only known misspellings: unfamiliar schools, companies and personal domains are allowed.
const EMAIL_DOMAIN_TYPOS = {
  "gnail.com": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com", "gmai.com": "gmail.com", "gmail.con": "gmail.com", "gmail.cmo": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "ucalgary.con": "ucalgary.ca"
};
let pendingRegistration = null;   // { key: the details sent, id: their requestId } until the server confirms the sign-up

async function onSubmit(ev) {
  ev.preventDefault();
  const button = $("submit");
  if (button.disabled) return;
  const people = readPeople();
  const problem = firstProblem(people);
  const error = $("form-error");
  if (problem) { error.textContent = problem; error.hidden = false; return; }
  error.hidden = true;

  button.disabled = true;
  button.textContent = T.submitting;
  // Busy or slow? Try again by itself. The same requestId on every try means the server can never create two registrations.
  // Pressing Register again with the same details (after a dropped connection) keeps that id too; a finished sign-up gets a new one.
  const details = {
    slug: currentEvent.slug,
    people,
    etransferName: $("etransfer-name") ? $("etransfer-name").value.trim() : "",
    website: $("website").value
  };
  const key = JSON.stringify(details);
  if (!pendingRegistration || pendingRegistration.key !== key) {
    pendingRegistration = { key, id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2) };
  }
  const requestId = pendingRegistration.id;
  let reply;
  for (let attempt = 1; attempt <= 4; attempt++) {
    reply = await api("register", { ...details, requestId });
    if (reply.ok || !["BUSY", "TEMPORARY", "NETWORK"].includes(reply.error) || attempt === 4) break;
    button.textContent = T.submittingAgain;
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  button.disabled = false;
  button.textContent = T.submit;
  updateTotal();

  if (!reply.ok) {
    error.textContent = reply.error === "NETWORK" ? T.error : (reply.message || T.error);
    error.hidden = false;
    return;
  }
  pendingRegistration = null;
  showPaymentScreen(reply);
}

function showPaymentScreen(reply) {
  const free = reply.order.status === "paid";
  const emails = reply.emails || { confirmation: true, ticket: true };   // an older server doesn’t say: assume the old behaviour
  const review = !!reply.needsReview;   // $0 order held until an exec checks membership
  const flagged = reply.tickets.filter((t) => t.flag && t.flag.indexOf("Member price") === 0);
  $("page").innerHTML = `
    <article class="done">
      ${pandaImg(!review && free ? "success" : "almost")}
      <h1 class="page-title">${review ? T.reviewTitle : free ? T.registeredFree : T.almostDone}</h1>
      ${review ? `<p class="lead">${T.reviewNote}</p>` : free ? (emails.ticket ? "" : `<p class="keep-note"><strong>${T.freeNoEmailNote}</strong></p>`) : `
        <p class="lead">${T.sendEtransfer}</p>
        <div class="pay-box">
          <div class="pay-row"><span>${T.amount}</span><div><strong class="big">${money(reply.order.total)}</strong> <small class="muted">${T.exactly}</small></div></div>
          <div class="pay-row"><span>${T.sendTo}</span><div><strong>${escapeHtml(reply.etransferEmail)}</strong>
            <button class="copy" data-copy="${escapeAttr(reply.etransferEmail)}">${T.copy}</button></div></div>
          <div class="pay-row"><span>${T.message}</span><div><strong class="code">${escapeHtml(reply.order.code)}</strong>
            <button class="copy" data-copy="${escapeAttr(reply.order.code)}">${T.copy}</button></div></div>
        </div>
        <p class="muted small">${T.noMessageNote}</p>
        <p>${emails.ticket ? T.confirmNote : T.confirmNoteLink}</p>
        ${emails.confirmation ? "" : `<p class="keep-note"><strong>${T.keepPageNote}</strong></p>`}
        <p class="status-line"><strong>${T.statusHeading}:</strong> ${T.statusWaiting}</p>`}

      <h2 class="small-heading">${free && !review ? T.myTicketsTitle : T.ticketsHeading}</h2>
      <ul class="ticket-list">${reply.tickets.map((t) => `
        <li><span>${escapeHtml(t.name)} · ${escapeHtml(t.ticketType)}${t.page ? `<br><a class="ticket-open" href="${escapeAttr(new URL(t.page, location.href).href)}">${free ? T.openTicket : T.statusLink}</a>` : ""}</span><strong>${money(t.price)}</strong></li>`).join("")}
      </ul>
      ${review ? "" : flagged.map((t) => `<p class="flag-note">${escapeHtml(T.flagNote(t.name))}</p>`).join("")}
      ${reply.emailSent ? `<p class="muted small">${T.emailedCopy}</p>` : ""}
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

function trustedPreviewOrigin(origin) {
  if (origin === "https://exec.ucalgarycss.ca") return true;
  try {
    const editor = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"];
    return local.includes(location.hostname) && local.includes(editor.hostname) && ["http:", "https:"].includes(editor.protocol);
  } catch (e) { return false; }
}

// ---- Start --------------------------------------------------------------------

function start() {
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
  $("contact-link").textContent = CONTACT_EMAIL;
  $("contact-link").href = "mailto:" + CONTACT_EMAIL;
  $("instagram-link").href = INSTAGRAM_URL;

  const previewKey = new URLSearchParams(location.hash.slice(1)).get("preview");
  if (previewKey) {
    const editor = window.opener;
    if (!editor) return showPandaError(T.error, null, true);
    // The editor can be on a different host. Only the opener and this one-use key may supply the preview.
    const receive = (message) => {
      if (!trustedPreviewOrigin(message.origin) || message.source !== editor || message.data?.previewKey !== previewKey || !message.data.event) return;
      window.removeEventListener("message", receive);
      clearTimeout(timeout);
      window.opener = null;
      renderEvent(message.data.event);
    };
    window.addEventListener("message", receive);
    editor.postMessage({ previewReady: previewKey }, "*");
    const timeout = setTimeout(() => {
      window.removeEventListener("message", receive);
      showPandaError(T.error, null, true);
    }, 60000);
    return;
  }
  const slug = new URLSearchParams(location.search).get("e");
  slug ? showEvent(slug) : showEventList();
}

start();
