// CSS Exec Portal — Events tab: list, create, edit, publish.

let globalEventId = "";   // the event every tab is looking at (desktop picker in the top bar)

const eventsState = { events: [], editing: null, loaded: false, showArchived: false };

// ---- Tabs -------------------------------------------------------------------

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("tab-overview").hidden = name !== "overview";
  $("tab-members").hidden = name !== "members";
  $("tab-events").hidden = name !== "events";
  $("tab-payments").hidden = name !== "payments";
  $("tab-door").hidden = name !== "door";
  $("tab-activity").hidden = name !== "activity";
  $("tab-settings").hidden = name !== "settings";
  $("crumb").textContent = { overview: T.tabOverview, members: T.tabMembers, events: T.tabEvents, payments: T.tabPayments, door: T.tabDoor, activity: T.tabActivity, settings: T.tabSettings }[name] || "";
  document.body.classList.remove("nav-open");
  window.scrollTo(0, 0);
  if (name !== "door" && doorState.scanner) stopCamera();
  if (name === "overview") openOverview();
  if (name === "events") { showEventsList(); if (!eventsState.loaded) loadEvents(); }
  if (name === "payments") openPaymentsTab();
  if (name === "door") openDoorTab();
  if (name === "activity") openActivityTab();
  if (name === "settings") openSettingsTab();
  if (name === "members") openMembersTab();
}

// ---- List -------------------------------------------------------------------

async function loadEvents() {
  $("events-status").textContent = T.loadingEvents;
  const reply = await api("listEvents");
  if (!reply.ok) return handleEventError(reply, $("events-status"));
  eventsState.events = reply.events;
  eventsState.counts = reply.counts || {};
  eventsState.loaded = true;
  renderEvents();
  renderGlobalEvent();
}

/** One event picker in the top bar (wide screens) that Payments and Door both follow. */
function renderGlobalEvent() {
  const events = activeEvents();
  const select = $("global-event");
  select.hidden = !events.length;
  if (!events.length) return;
  if (!globalEventId || !events.some((e) => e.id === globalEventId)) {
    const today = todayMountain();
    const next = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    globalEventId = (next || events[0]).id;
    payState.eventId = globalEventId;
    doorState.eventId = globalEventId;
  }
  select.innerHTML = events.map((e) =>
    `<option value="${e.id}" ${e.id === globalEventId ? "selected" : ""}>${escapeHtml(e.name)} (${escapeHtml(e.date)})</option>`).join("");
}

function onGlobalEventChange() {
  globalEventId = $("global-event").value;
  payState.eventId = globalEventId;
  doorState.eventId = globalEventId;
  if (!$("tab-payments").hidden) openPaymentsTab();
  if (!$("tab-door").hidden) openDoorTab();
}

/** Events the day-to-day tabs should offer (not drafts, not archived). */
function activeEvents() {
  return eventsState.events.filter((e) => e.status !== "draft" && e.status !== "archived");
}

function renderEvents() {
  const archived = eventsState.events.filter((e) => e.status === "archived");
  const list = eventsState.showArchived ? archived : eventsState.events.filter((e) => e.status !== "archived");
  const toggle = $("toggle-archived");
  toggle.hidden = !archived.length;
  toggle.textContent = eventsState.showArchived ? T.hideArchived : T.showArchived(archived.length);
  $("events-status").textContent = list.length ? "" : T.noEvents;
  $("events-list").innerHTML = list.map((e) => {
    const c = (eventsState.counts || {})[e.id] || { awaiting: 0, paid: 0 };
    const pct = e.capacity ? Math.min(100, Math.round((c.paid / e.capacity) * 100)) : 0;
    const cover = e.imageUrl ? `<img class="ev-cover" src="${escapeHtml(e.imageUrl)}" alt="" loading="lazy">` : "";
    return `
    <li class="card event-row event-card" data-id="${e.id}">
      <div class="ev-banner">${cover}${statusPill(e.status)}${e.entryOpen ? `<span class="live-pill">🟢 ${T.doorsOpen}</span>` : ""}</div>
      <div class="ev-info">
        <div class="name">${escapeHtml(e.name)}</div>
        <div class="sub">${escapeHtml(formatEventDate(e))}${e.location ? " · " + escapeHtml(e.location) : ""}</div>
        <div class="sub">${countsText(e)}</div>
        ${e.capacity ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}
        <div class="badges">${e.ticketTypes.map((t) =>
          `<span class="pill neutral">${escapeHtml(t.name)} ${money(t.price)}</span>`).join("")}</div>
      </div>
      <div class="event-actions">
        <button class="link" data-action="attendees" data-id="${e.id}">${T.attendees}</button>
        <button class="link" data-action="edit" data-id="${e.id}">${T.edit}</button>
        <button class="link" data-action="duplicate" data-id="${e.id}">${T.duplicate}</button>
        ${e.status === "draft" ? `<button class="link" data-action="publish" data-id="${e.id}">${T.publish}</button>` : ""}
        ${e.status === "published" ? `<button class="link" data-action="close" data-id="${e.id}">${T.closeRegistration}</button>` : ""}
        ${e.status === "closed" ? `<button class="link" data-action="reopen" data-id="${e.id}">${T.reopen}</button>` : ""}
        ${e.status !== "draft" && e.status !== "archived" ? `<a class="link" target="_blank" rel="noopener" href="${publicLink(e)}">${T.viewPublicPage}</a>` : ""}
        ${state.role === "admin" && e.status !== "archived" ? `<button class="link danger" data-action="archive" data-id="${e.id}">${T.archive}</button>` : ""}
        ${state.role === "admin" && e.status === "archived" ? `<button class="link" data-action="restore" data-id="${e.id}">${T.restore}</button>` : ""}
        ${state.role === "admin" ? `<button class="link danger" data-action="delete" data-id="${e.id}">${T.deleteEvent}</button>` : ""}
      </div>
    </li>`;
  }).join("");
}

async function onEventsListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    // Clicking anywhere else on the card opens its attendees (links such as "Public page" keep doing their own thing).
    const card = event.target.closest(".event-card");
    if (!card || event.target.closest("a, button")) return;
    const opened = eventsState.events.find((e) => e.id === card.dataset.id);
    if (opened) openAttendees(opened);
    return;
  }
  event.stopPropagation();
  const target = eventsState.events.find((e) => e.id === button.dataset.id);
  if (!target) return;
  if (button.dataset.action === "edit") return openEditor(target);
  if (button.dataset.action === "attendees") return openAttendees(target);
  if (button.dataset.action === "duplicate") return openEditor(copyOfEvent(target), false, T.duplicateTitle(target.name));
  if (button.dataset.action === "delete") return deleteEventForGood(target, button);

  const status = { publish: "published", close: "closed", reopen: "published", archive: "archived", restore: "closed" }[button.dataset.action];
  if (status === "published" && target.status === "draft" && !confirm(T.confirmPublish)) return;
  if (button.dataset.action === "close" && !confirm(T.confirmClose(target.name))) return;
  if (status === "archived" && !confirm(T.confirmArchive(target.name))) return;
  const restoring = status === "closed" && target.status === "archived";
  if (restoring && !confirm(T.confirmRestore(target.name))) return;
  const label = button.textContent;
  button.disabled = true;
  if (status === "archived") button.textContent = T.archiving;
  if (restoring) button.textContent = T.restoring;
  const reply = await api("setEventStatus", { eventId: target.id, status });
  if (!reply.ok) { button.disabled = false; button.textContent = label; return handleEventError(reply, $("events-status")); }
  if (status === "archived") showToast(T.archivedDone(reply.tickets || 0, reply.orders || 0));
  if (restoring) showToast(T.restoredDone(reply.tickets || 0, reply.orders || 0));
  if (status === "archived" || restoring) { eventsState.loaded = false; await loadEvents(); return; }   // counts and dates changed
  target.status = status;
  renderEvents();
}

/** Delete an event and everything on it, for good. The admin types the event's name; real payments need a second yes. */
async function deleteEventForGood(target, button) {
  const typed = prompt(T.deletePrompt(target.name));
  if (typed === null) return;
  button.disabled = true;
  let reply = await api("deleteEvent", { eventId: target.id, confirmName: typed });
  if (!reply.ok && reply.error === "NEEDS_FORCE") {
    if (!confirm(`${reply.message}

${T.deleteMoneyConfirm}`)) { button.disabled = false; return; }
    reply = await api("deleteEvent", { eventId: target.id, confirmName: typed, force: true });
  }
  button.disabled = false;
  if (!reply.ok) return handleEventError(reply, $("events-status"));
  showToast(T.deletedDone(target.name, reply.tickets || 0, reply.orders || 0));
  eventsState.loaded = false;
  await loadEvents();
}

// ---- Editor -----------------------------------------------------------------

/** A new event that starts as a copy of another: same prices, questions, capacity. The date is left for you to pick. */
function copyOfEvent(source) {
  const copy = JSON.parse(JSON.stringify(source));
  ["id", "slug", "status", "entryOpen", "createdBy", "createdAt", "updatedBy", "updatedAt"].forEach((k) => delete copy[k]);
  copy.name = `${source.name} (copy)`;
  copy.date = "";
  copy.registrationCloses = "";
  copy.ticketTypes.forEach((t) => delete t.id);
  copy.questions.forEach((q) => delete q.id);
  return copy;
}

function openEditor(existing, isEdit = !!existing, title) {
  const e = existing || {
    name: "", date: "", startTime: "", endTime: "", location: "", description: "",
    capacity: null, capacityRule: "paid", imageFileId: "", imageUrl: "", codePrefix: "",
    ticketTypes: [{ name: "Member", price: 0, needsMembership: true }, { name: "Non-member", price: 0 }],
    questions: []
  };
  eventsState.editing = JSON.parse(JSON.stringify(e));

  $("editor-title").textContent = title || (isEdit ? T.editEventTitle : T.newEventTitle);
  $("editor-hint").textContent = title ? T.duplicateHint : "";
  $("editor-hint").hidden = !title;
  $("ev-name").value = e.name;
  $("ev-date").value = e.date;
  $("ev-start").value = e.startTime;
  $("ev-end").value = e.endTime;
  $("ev-location").value = e.location;
  $("ev-description").value = e.description;
  $("ev-capacity").value = e.capacity ?? "";
  $("ev-capacity-rule").value = e.capacityRule || "paid";
  $("ev-waitlist").checked = !!e.waitlist;
  $("ev-code-prefix").value = e.codePrefix || "";
  $("ev-closes").value = e.registrationCloses || "";
  $("ev-image-file").value = "";
  $("ev-image-grid").hidden = true;
  $("ev-image-pick").textContent = T.pickPrevImage;
  $("ev-image-status").textContent = "";
  showImagePreview(e.imageUrl);
  renderTicketTypes();
  renderQuestions();
  setEditorError("");

  $("events-list-view").hidden = true;
  $("event-editor-view").hidden = false;
  window.scrollTo(0, 0);
  $("ev-name").focus();
}

function showEventsList() {
  $("event-detail-view").hidden = true;
  $("event-editor-view").hidden = true;
  $("events-list-view").hidden = false;
}

function renderTicketTypes() {
  $("ev-ticket-types").innerHTML = eventsState.editing.ticketTypes.map((t, i) => `
    <div class="repeat-row" data-index="${i}">
      <div class="grid-ticket">
        <div><label>${T.ticketName}</label><input data-field="name" value="${escapeHtml(t.name)}" maxlength="60"></div>
        <div><label>${T.ticketPrice}</label><input data-field="price" type="number" min="0" step="0.5" inputmode="decimal" value="${t.price ?? 0}"></div>
      </div>
      <label class="check"><input type="checkbox" data-field="needsMembership" ${t.needsMembership ? "checked" : ""}> ${T.needsMembership}</label>
      <button type="button" class="link danger" data-remove="ticket">${T.remove}</button>
    </div>`).join("");
}

function renderQuestions() {
  $("ev-questions").innerHTML = eventsState.editing.questions.map((q, i) => `
    <div class="repeat-row" data-index="${i}">
      <label>${T.questionLabel}</label>
      <input data-field="label" value="${escapeHtml(q.label)}" maxlength="150">
      <div class="grid-2">
        <div><label>${T.questionType}</label>
          <select data-field="type">
            <option value="text" ${q.type !== "choice" ? "selected" : ""}>${T.typeText}</option>
            <option value="choice" ${q.type === "choice" ? "selected" : ""}>${T.typeChoice}</option>
          </select></div>
        <label class="check align-end"><input type="checkbox" data-field="required" ${q.required ? "checked" : ""}> ${T.required}</label>
      </div>
      <div data-options ${q.type === "choice" ? "" : "hidden"}>
        <label>${T.questionOptions}</label>
        <input data-field="options" value="${escapeHtml((q.options || []).join(", "))}">
      </div>
      <button type="button" class="link danger" data-remove="question">${T.remove}</button>
    </div>`).join("");
}

/** Copies what's typed in the repeat rows back into eventsState.editing. */
function readRepeatRows(containerId, key) {
  const items = eventsState.editing[key];
  $(containerId).querySelectorAll(".repeat-row").forEach((row) => {
    const item = items[Number(row.dataset.index)];
    row.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      item[field] = input.type === "checkbox" ? input.checked
        : field === "price" ? Number(input.value)
        : field === "options" ? input.value.split(",").map((s) => s.trim()).filter(Boolean)
        : input.value;
    });
  });
}

function onRepeatClick(event) {
  const remove = event.target.closest("[data-remove]");
  if (!remove) return;
  const key = remove.dataset.remove === "ticket" ? "ticketTypes" : "questions";
  readAllRows();
  eventsState.editing[key].splice(Number(remove.closest(".repeat-row").dataset.index), 1);
  key === "ticketTypes" ? renderTicketTypes() : renderQuestions();
}

function onQuestionTypeChange(event) {
  if (event.target.dataset.field !== "type") return;
  event.target.closest(".repeat-row").querySelector("[data-options]").hidden = event.target.value !== "choice";
}

function readAllRows() {
  readRepeatRows("ev-ticket-types", "ticketTypes");
  readRepeatRows("ev-questions", "questions");
}

// ---- Image upload -------------------------------------------------------------

async function onImagePicked() {
  const file = $("ev-image-file").files[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { $("ev-image-status").textContent = T.imageTooBig; return; }
  $("ev-image-status").textContent = T.uploading;
  const dataUrl = await shrinkImage(file, 1600, 0.85);
  const reply = await api("uploadImage", { dataUrl, filename: file.name });
  if (!reply.ok) return handleEventError(reply, $("ev-image-status"));
  eventsState.editing.imageFileId = reply.fileId;
  eventsState.editing.imageUrl = reply.url;
  showImagePreview(dataUrl);
  $("ev-image-status").textContent = T.uploaded;
}

/** "Pick a previous image": a grid of the pictures already in Drive; clicking one reuses it (no re-upload). */
async function togglePreviousImages() {
  const grid = $("ev-image-grid");
  if (!grid.hidden) { grid.hidden = true; $("ev-image-pick").textContent = T.pickPrevImage; return; }
  grid.hidden = false;
  $("ev-image-pick").textContent = T.hidePrevImages;
  grid.innerHTML = `<p class="muted small">${T.loadingImages}</p>`;
  const reply = await api("listImages");
  if (!reply.ok) { grid.hidden = true; $("ev-image-pick").textContent = T.pickPrevImage; return handleEventError(reply, $("ev-image-status")); }
  grid.innerHTML = reply.images.length
    ? reply.images.map((im) => `<button type="button" class="image-tile${im.id === eventsState.editing.imageFileId ? " picked" : ""}" data-image="${escapeHtml(im.id)}" data-url="${escapeHtml(im.url)}" title="${escapeHtml(im.name)}"><img src="${escapeHtml(im.thumb)}" alt="${escapeHtml(im.name)}" loading="lazy"></button>`).join("")
    : `<p class="muted small">${T.noPrevImages}</p>`;
}

function onPreviousImageClick(event) {
  const tile = event.target.closest(".image-tile");
  if (!tile) return;
  eventsState.editing.imageFileId = tile.dataset.image;
  eventsState.editing.imageUrl = tile.dataset.url;
  showImagePreview(tile.dataset.url);
  document.querySelectorAll("#ev-image-grid .image-tile").forEach((t) => t.classList.toggle("picked", t === tile));
  $("ev-image-status").textContent = T.imagePicked;
}

/** Resizes a photo in the browser so uploads are small (phones take huge photos). */
function shrinkImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function showImagePreview(url) {
  $("ev-image-preview").hidden = !url;
  if (url) $("ev-image-preview").src = url;
}

// ---- Save -------------------------------------------------------------------

async function saveEvent(publish) {
  readAllRows();
  const e = eventsState.editing;
  const payload = {
    ...e,
    name: $("ev-name").value,
    date: $("ev-date").value,
    startTime: $("ev-start").value,
    endTime: $("ev-end").value,
    location: $("ev-location").value,
    description: $("ev-description").value,
    capacity: $("ev-capacity").value,
    capacityRule: $("ev-capacity-rule").value,
    waitlist: $("ev-waitlist").checked,
    codePrefix: $("ev-code-prefix").value,
    registrationCloses: $("ev-closes").value
  };
  if (publish && e.status !== "published" && !confirm(T.confirmPublish)) return;

  setEditorBusy(true);
  const reply = await api("saveEvent", { event: payload });
  if (!reply.ok) { setEditorBusy(false); return setEditorError(errorText(reply)); }

  if (publish && reply.event.status !== "published") {
    const status = await api("setEventStatus", { eventId: reply.event.id, status: "published" });
    if (!status.ok) { setEditorBusy(false); return setEditorError(errorText(status)); }
  }
  setEditorBusy(false);
  eventsState.loaded = false;
  showEventsList();
  loadEvents();
}

function setEditorBusy(busy) {
  $("save-draft-button").disabled = busy;
  $("save-publish-button").disabled = busy;
  $("save-publish-button").textContent = busy ? T.saving : T.savePublish;
}

function setEditorError(text) {
  $("editor-error").textContent = text;
  $("editor-error").hidden = !text;
}

// ---- Helpers ----------------------------------------------------------------

function handleEventError(reply, el) {
  if (reply.error === "NOT_LOGGED_IN") { signOutLocally(); return showLogin(errorText(reply)); }
  el.innerHTML = pandaImg("error", "pl-inline") + pandaEsc(errorText(reply));   // the confused panda beside the message
}

function statusPill(status) {
  const cls = { draft: "neutral", published: "good", closed: "warn" }[status] || "neutral";
  const text = { draft: T.statusDraft, published: T.statusPublished, closed: T.statusClosed, archived: T.statusArchived }[status] || status;
  return `<span class="pill ${cls}">${text}</span>`;
}

function countsText(e) {
  const c = (eventsState.counts || {})[e.id] || { awaiting: 0, paid: 0 };
  const cap = e.capacity ? ` / ${e.capacity}` : "";
  return T.countsLine(c.paid, cap, c.awaiting);
}

function money(price) {
  return Number(price) === 0 ? T.free : "$" + Number(price).toFixed(Number(price) % 1 ? 2 : 0);
}

function formatEventDate(e) {
  if (!e.date) return "";
  const d = new Date(e.date + "T12:00:00");
  const day = d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = [e.startTime, e.endTime].filter(Boolean).map(formatTime).join("–");
  return time ? `${day} · ${time}` : day;
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function publicLink(e) {
  return `${PUBLIC_SITE_URL}?e=${encodeURIComponent(e.slug)}`;
}

// ---- Wire up ----------------------------------------------------------------

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
$("global-event").addEventListener("change", onGlobalEventChange);
$("new-event-button").addEventListener("click", () => openEditor(null));
$("toggle-archived").addEventListener("click", () => { eventsState.showArchived = !eventsState.showArchived; renderEvents(); });
$("editor-back-button").addEventListener("click", showEventsList);
$("editor-cancel").addEventListener("click", showEventsList);
$("nav-burger").addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("sidebar").addEventListener("click", (e) => { if (e.target.closest(".tab")) document.body.classList.remove("nav-open"); });
document.querySelector(".mainwrap").addEventListener("click", (e) => { if (!e.target.closest("#nav-burger")) document.body.classList.remove("nav-open"); });
$("events-list").addEventListener("click", onEventsListClick);
$("add-ticket-type").addEventListener("click", () => {
  readAllRows();
  eventsState.editing.ticketTypes.push({ name: "", price: 0, needsMembership: false });
  renderTicketTypes();
});
$("add-question").addEventListener("click", () => {
  readAllRows();
  eventsState.editing.questions.push({ label: "", type: "text", options: [], required: false });
  renderQuestions();
});
$("ev-ticket-types").addEventListener("click", onRepeatClick);
$("ev-questions").addEventListener("click", onRepeatClick);
$("ev-questions").addEventListener("change", onQuestionTypeChange);
$("ev-image-file").addEventListener("change", onImagePicked);
$("ev-image-pick").addEventListener("click", togglePreviousImages);
$("ev-image-grid").addEventListener("click", onPreviousImageClick);
$("event-form").addEventListener("submit", (ev) => { ev.preventDefault(); saveEvent(false); });
$("save-publish-button").addEventListener("click", () => saveEvent(true));
