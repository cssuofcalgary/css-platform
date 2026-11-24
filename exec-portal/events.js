// CSS Exec Portal — Events tab: list, create, edit, publish.

let globalEventId = "";   // the event every tab is looking at (desktop picker in the top bar)

const eventsState = { events: [], editing: null, loaded: false, showArchived: false };

// ---- Tabs -------------------------------------------------------------------

async function switchTab(name) {
  if (!(await leaveEventEditor())) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("tab-overview").hidden = name !== "overview";
  $("tab-members").hidden = name !== "members";
  $("tab-partners").hidden = name !== "partners";
  $("tab-events").hidden = name !== "events";
  $("tab-payments").hidden = name !== "payments";
  $("tab-door").hidden = name !== "door";
  $("tab-activity").hidden = name !== "activity";
  $("tab-settings").hidden = name !== "settings";
  $("crumb").textContent = { overview: T.tabOverview, members: T.tabMembers, partners: T.tabPartners, events: T.tabEvents, payments: T.tabPayments, door: T.tabDoor, activity: T.tabActivity, settings: T.tabSettings }[name] || "";
  document.body.classList.remove("nav-open");
  try { if (!SCANNER_MODE) sessionStorage.setItem("css_tab", name); } catch (e) { /* private window: the tab just isn't remembered */ }
  window.scrollTo(0, 0);
  if (name !== "door" && doorState.scanner) stopCamera();
  if (name === "overview") openOverview();
  if (name === "events") { showEventsList(); if (!eventsState.loaded || eventsState.fromDevice) loadEvents(); }
  if (name === "payments") openPaymentsTab();
  if (name === "door") openDoorTab();
  if (name === "activity") openActivityTab();
  if (name === "settings") openSettingsTab();
  if (name === "members") openMembersTab();
  if (name === "partners") loadPartners();
}

// ---- List -------------------------------------------------------------------

async function loadEvents() {
  // First time: show the copy kept on this device straight away, then freshen it quietly.
  if (!eventsState.loaded) {
    const kept = deviceLoad("events");
    if (kept && Array.isArray(kept.events)) {
      eventsState.events = kept.events;
      eventsState.counts = kept.counts || {};
      eventsState.loaded = true;
      eventsState.fromDevice = true;
      renderEvents();
      renderGlobalEvent();
    }
  }
  if (!eventsState.loaded) $("events-status").textContent = T.loadingEvents;
  const reply = await api("listEvents", {}, { quiet: eventsState.loaded });
  if (!reply.ok) {
    if (eventsState.fromDevice && reply.error !== "NOT_LOGGED_IN") return;   // keep showing the kept copy; the connection notice says why
    return handleEventError(reply, $("events-status"));
  }
  eventsState.events = reply.events;
  eventsState.counts = reply.counts || {};
  eventsState.loaded = true;
  eventsState.fromDevice = false;
  deviceSave("events", { events: reply.events, counts: reply.counts || {} });
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
  doorState.picked = true;
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
      <div class="ev-banner">${cover}${statusPill(e.status, e)}${e.entryOpen ? `<span class="live-pill">🟢 ${T.doorsOpen}</span>` : ""}</div>
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
  // Never change an event from the copy kept on this device: get the latest first.
  if (eventsState.fromDevice) {
    await loadEvents();
    if (eventsState.fromDevice) return showToast(T.keptCopyOnly);
  }
  const target = eventsState.events.find((e) => e.id === button.dataset.id);
  if (!target) return;
  if (button.dataset.action === "edit") return openEditor(target);
  if (button.dataset.action === "attendees") return openAttendees(target);
  if (button.dataset.action === "duplicate") return openEditor(copyOfEvent(target), false, T.duplicateTitle(target.name));
  if (button.dataset.action === "delete") return deleteEventForGood(target, button);

  const status = { publish: "published", close: "closed", reopen: "published", archive: "archived", restore: "closed" }[button.dataset.action];
  if (status === "published" && target.status === "draft" && !(await askConfirm(T.confirmPublish))) return;
  if (button.dataset.action === "close" && !(await askConfirm(T.confirmClose(target.name), T.closeRegistration))) return;
  if (status === "archived" && !(await askConfirm(T.confirmArchive(target.name)))) return;
  const restoring = status === "closed" && target.status === "archived";
  if (restoring && !(await askConfirm(T.confirmRestore(target.name)))) return;
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
  const typed = await askText(T.deletePrompt(target.name));
  if (typed === null) return;
  button.disabled = true;
  let reply = await api("deleteEvent", { eventId: target.id, confirmName: typed });
  if (!reply.ok && reply.error === "NEEDS_FORCE") {
    if (!(await askConfirm(`${reply.message}

${T.deleteMoneyConfirm}`))) { button.disabled = false; return; }
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
  ["id", "slug", "status", "entryOpen", "summary", "editDraft", "createdBy", "createdAt", "updatedBy", "updatedAt"].forEach((k) => delete copy[k]);
  copy.name = `${source.name} (copy)`;
  copy.date = "";
  copy.registrationCloses = "";
  // new ticket ids for the copy, and each question's "only for these tickets" moved over to them
  const newIds = {};
  copy.ticketTypes.forEach((t) => { const id = newTicketTypeId(); if (t.id) newIds[t.id] = id; t.id = id; });
  copy.questions.forEach((q) => {
    delete q.id;
    q.forTickets = (q.forTickets || []).map((id) => newIds[id]).filter(Boolean);
  });
  return copy;
}

/** Ticket types get their id here (same shape as the server's), so a question can be tied to a ticket type that isn't saved yet. */
function newTicketTypeId() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
  return "TT" + hex.toUpperCase();
}

function ensureTicketTypeIds() {
  eventsState.editing.ticketTypes.forEach((t) => { if (!t.id) t.id = newTicketTypeId(); });
}

function openEditor(existing, isEdit = !!existing, title) {
  const e = existing ? { ...existing, ...existing.editDraft } : {
    name: "", date: "", startTime: "", endTime: "", location: "", description: "", announcement: "",
    capacity: null, capacityRule: "paid", imageFileId: "", imageUrl: "", codePrefix: "",
    ticketTypes: [{ name: "Member", price: 0, needsMembership: true }, { name: "Non-member", price: 0 }],
    questions: []
  };
  eventsState.editing = JSON.parse(JSON.stringify(e));
  delete eventsState.editing.summary;
  delete eventsState.editing.editDraft;
  ensureTicketTypeIds();

  $("editor-title").textContent = title || (isEdit ? T.editEventTitle : T.newEventTitle);
  $("editor-hint").textContent = title ? T.duplicateHint : "";
  $("editor-hint").hidden = !title;
  $("ev-name").value = e.name;
  $("ev-date").value = e.date;
  $("ev-start").value = e.startTime;
  $("ev-end").value = e.endTime;
  $("ev-location").value = e.location;
  $("ev-description").value = e.description;
  $("ev-announcement").value = e.announcement || "";
  $("ev-capacity").value = e.capacity ?? "";
  $("ev-capacity-rule").value = e.capacityRule || "paid";
  $("ev-waitlist").checked = !!e.waitlist;
  $("ev-mail-registration").checked = !!e.mailRegistration;
  $("ev-mail-tickets").checked = e.mailTickets !== false;   // a new event starts with the defaults: ticket on, registration email off, reminders off
  $("ev-mail-reminders").checked = !!e.mailReminders;
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
  updateEditorStep();
  eventsState.savedEditor = JSON.stringify(readEventEditor());
  setEditorBusy(false);
}

async function showEventsList() {
  if (!(await leaveEventEditor())) return;
  $("event-detail-view").hidden = true;
  $("event-editor-view").hidden = true;
  $("events-list-view").hidden = false;
}

function eventEditorDirty() {
  return !!eventsState.editing && !$("event-editor-view").hidden &&
    (eventsState.saving || eventsState.uploading || JSON.stringify(readEventEditor()) !== eventsState.savedEditor);
}

async function leaveEventEditor() {
  if (eventsState.saving || eventsState.uploading) { setEditorError(T.eventWait); return false; }
  if (eventEditorDirty() && !(await askConfirm(T.eventLeaveConfirm, T.eventLeave))) return false;
  eventsState.editing = null;
  return true;
}

// Browsers require their own warning for refresh/close; a custom dialog cannot delay closing a tab.
window.addEventListener("beforeunload", (event) => {
  if (!eventEditorDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

function renderTicketTypes() {
  $("ev-ticket-types").innerHTML = eventsState.editing.ticketTypes.map((t, i) => `
    <div class="repeat-row" data-index="${i}">
      <div class="grid-ticket">
        <div><label>${T.ticketName}</label><input data-field="name" value="${escapeHtml(t.name)}" maxlength="60"></div>
        <div><label>${T.ticketPrice}</label><input data-field="price" type="number" min="0" step="0.5" inputmode="decimal" value="${t.price ?? 0}"></div>
      </div>
      <label class="check"><input type="checkbox" data-field="needsMembership" ${t.needsMembership ? "checked" : ""}> ${T.needsMembership}</label>
      <div class="ticket-actions">
        <button type="button" class="link" data-move="-1" ${i === 0 ? "disabled" : ""}>${T.ticketMoveUp}</button>
        <button type="button" class="link" data-move="1" ${i === eventsState.editing.ticketTypes.length - 1 ? "disabled" : ""}>${T.ticketMoveDown}</button>
        <button type="button" class="link danger" data-remove="ticket">${T.remove}</button>
      </div>
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
      ${questionTicketChoice(q)}
      <button type="button" class="link danger" data-remove="question">${T.remove}</button>
    </div>`).join("");
}

/** "Only for these tickets": one box per ticket type. None ticked = the question is for every ticket. */
function questionTicketChoice(q) {
  const types = eventsState.editing.ticketTypes;
  if (types.length < 2) return "";
  const picked = q.forTickets || [];
  return `<fieldset class="for-tickets"><legend>${T.questionForTickets}</legend><div class="chips">${types.map((t) => `
    <label class="check"><input type="checkbox" data-for-ticket="${escapeHtml(t.id)}" ${picked.includes(t.id) ? "checked" : ""}> ${escapeHtml(t.name || T.ticketUnnamed)}</label>`).join("")}
  </div></fieldset>`;
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
    if (key === "questions" && row.querySelector("[data-for-ticket]")) {
      item.forTickets = [...row.querySelectorAll("[data-for-ticket]:checked")].map((box) => box.dataset.forTicket);
    }
  });
}

function onRepeatClick(event) {
  const move = event.target.closest("[data-move]");
  if (move) {
    readAllRows();
    moveTicketType(Number(move.closest(".repeat-row").dataset.index), Number(move.dataset.move));
    renderTicketTypes();
    renderQuestions();
    return;
  }
  const remove = event.target.closest("[data-remove]");
  if (!remove) return;
  const key = remove.dataset.remove === "ticket" ? "ticketTypes" : "questions";
  readAllRows();
  const [gone] = eventsState.editing[key].splice(Number(remove.closest(".repeat-row").dataset.index), 1);
  if (key === "ticketTypes") {
    // a question that was only for the removed ticket forgets it
    eventsState.editing.questions.forEach((q) => { q.forTickets = (q.forTickets || []).filter((id) => id !== gone.id); });
    renderTicketTypes();
  }
  renderQuestions();
}

function moveTicketType(index, direction) {
  const types = eventsState.editing.ticketTypes;
  const next = index + direction;
  if (next < 0 || next >= types.length) return;
  [types[index], types[next]] = [types[next], types[index]];
}

/** Renaming a ticket type updates the names in each question's "only for these tickets" boxes. */
function onTicketTypeTyped(event) {
  if (event.target.dataset.field !== "name") return;
  readAllRows();
  renderQuestions();
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
  eventsState.uploading = true;
  setEditorBusy(true);
  $("ev-image-status").textContent = T.uploading;
  try {
    const dataUrl = await shrinkImage(file, 1600, 0.85);
    const reply = await api("uploadImage", { dataUrl, filename: file.name });
    if (!reply.ok) return handleEventError(reply, $("ev-image-status"));
    eventsState.editing.imageFileId = reply.fileId;
    eventsState.editing.imageUrl = reply.url;
    showImagePreview(dataUrl);
    $("ev-image-status").textContent = T.uploaded;
  } catch (error) { $("ev-image-status").textContent = errorText({ error: "NETWORK" }); }
  finally { eventsState.uploading = false; setEditorBusy(false); }
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

function readEventEditor() {
  readAllRows();
  const e = eventsState.editing;
  return {
    ...e,
    name: $("ev-name").value,
    date: $("ev-date").value,
    startTime: $("ev-start").value,
    endTime: $("ev-end").value,
    location: $("ev-location").value,
    description: $("ev-description").value,
    announcement: $("ev-announcement").value,
    capacity: $("ev-capacity").value,
    capacityRule: $("ev-capacity-rule").value,
    waitlist: $("ev-waitlist").checked,
    mailRegistration: $("ev-mail-registration").checked,
    mailTickets: $("ev-mail-tickets").checked,
    mailReminders: $("ev-mail-reminders").checked,
    codePrefix: $("ev-code-prefix").value,
    registrationCloses: $("ev-closes").value
  };
}

async function saveEvent(publish) {
  if (eventsState.saving || eventsState.uploading) return;
  const payload = readEventEditor();
  if (publish && !(await askConfirm(payload.status === "published" || payload.status === "closed" ? T.eventPublishConfirm : T.confirmPublish))) return;

  eventsState.saving = true;
  setEditorBusy(true);
  try {
    const reply = await api("saveEvent", { event: { ...payload, saveDraft: !publish, publish } });
    if (!reply.ok) return setEditorError(errorText(reply));
    eventsState.editing = null;
    eventsState.loaded = false;
  } catch (error) {
    setEditorError(errorText({ error: "NETWORK" }));
    return;
  } finally {
    eventsState.saving = false;
    setEditorBusy(false);
  }
  await showEventsList();
  loadEvents();
}

function setEditorBusy(busy) {
  $("event-form").querySelectorAll("input, select, textarea, button").forEach((el) => { el.disabled = busy; });
  if (!busy && eventsState.editing) {
    $("ev-ticket-types").querySelectorAll("[data-move]").forEach((button) => {
      const next = Number(button.closest(".repeat-row").dataset.index) + Number(button.dataset.move);
      button.disabled = next < 0 || next >= eventsState.editing.ticketTypes.length;
    });
  }
  const live = eventsState.editing && ["published", "closed"].includes(eventsState.editing.status);
  $("save-publish-button").textContent = busy ? T.saving : live ? T.eventPublishChanges : T.savePublish;
}

function previewEvent() {
  if (eventsState.saving || eventsState.uploading) return;
  const draft = readEventEditor();
  const key = newTicketTypeId();
  const url = new URL(PUBLIC_SITE_URL, location.href);
  url.hash = "preview=" + key;
  const preview = window.open(url.href, "_blank");
  if (!preview) return setEditorError(T.eventPreviewBlocked);
  const receive = (message) => {
    if (message.source !== preview || message.origin !== url.origin || message.data?.previewReady !== key) return;
    preview.postMessage({ previewKey: key, event: {
      name: draft.name, slug: draft.slug || "", description: draft.description, announcement: draft.announcement, date: draft.date,
      startTime: draft.startTime, endTime: draft.endTime, location: draft.location, imageUrl: draft.imageUrl,
      ticketTypes: draft.ticketTypes, questions: draft.questions,
      registrationCloses: draft.registrationCloses || (draft.date ? draft.date + "T" + (draft.startTime || "23:59") : ""),
      registrationOpen: true, spotsLeft: null, soldOut: false,
      previewLabel: T.eventPreviewLabel
    } }, url.origin);
    window.removeEventListener("message", receive);
    clearTimeout(timeout);
  };
  window.addEventListener("message", receive);
  const timeout = setTimeout(() => window.removeEventListener("message", receive), 60000);
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

/**
 * A confirm box drawn in the page. The browser's own confirm() returns false without showing anything once
 * someone ticked "stop this page making dialogs" (and some phone browsers never show it), so the button looked dead.
 */
function askConfirm(message, yesLabel) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "edit-dialog";
    dialog.innerHTML = `<form method="dialog" class="editor">
      <p style="white-space:pre-line"></p>
      <div class="button-row">
        <button type="button" class="secondary" data-no>${escapeHtml(T.cancel)}</button>
        <button type="button" class="primary" data-yes>${escapeHtml(yesLabel || "OK")}</button>
      </div></form>`;
    dialog.querySelector("p").textContent = message;
    const done = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
    dialog.querySelector("[data-yes]").addEventListener("click", () => done(true));
    dialog.querySelector("[data-no]").addEventListener("click", () => done(false));
    dialog.addEventListener("cancel", (ev) => { ev.preventDefault(); done(false); });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/** Like askConfirm, with a box to type in. Answers the typed text, or null for Cancel. */
function askText(message, yesLabel, value) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "edit-dialog";
    dialog.innerHTML = `<form method="dialog" class="editor">
      <p style="white-space:pre-line"></p>
      <input type="text">
      <div class="button-row">
        <button type="button" class="secondary" data-no>${escapeHtml(T.cancel)}</button>
        <button type="submit" class="primary">${escapeHtml(yesLabel || "OK")}</button>
      </div></form>`;
    dialog.querySelector("p").textContent = message;
    const input = dialog.querySelector("input");
    input.value = value || "";
    const done = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
    dialog.querySelector("form").addEventListener("submit", (ev) => { ev.preventDefault(); done(input.value); });
    dialog.querySelector("[data-no]").addEventListener("click", () => done(null));
    dialog.addEventListener("cancel", (ev) => { ev.preventDefault(); done(null); });
    document.body.appendChild(dialog);
    dialog.showModal();
    input.select();
  });
}

/** True when the event says Published but its sign-up window has already ended (default: when the event starts). */
function signupsEnded(e) {
  if (e.status !== "published") return false;
  const now = new Date().toLocaleString("sv-SE", { timeZone: "America/Edmonton" }).slice(0, 16).replace(" ", "T");
  return now >= (e.registrationCloses || e.date + "T" + (e.startTime || "23:59"));
}

function statusPill(status, e) {
  const ended = e && signupsEnded(e);
  const cls = { draft: "neutral", published: ended ? "warn" : "good", closed: "warn" }[status] || "neutral";
  const text = { draft: T.statusDraft, published: ended ? T.statusEnded : T.statusPublished, closed: T.statusClosed, archived: T.statusArchived }[status] || status;
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
// Tapping anywhere outside the menu closes it. (The dark cover is part of <body>, on top of the page, so a handler on the page itself never saw the tap.)
document.addEventListener("click", (e) => {
  if (document.body.classList.contains("nav-open") && !e.target.closest("#sidebar, #nav-burger")) document.body.classList.remove("nav-open");
});
// Swipe: left closes the open menu; right from the very left edge of the screen opens it (phones and small windows)
let swipeStart = null;
document.addEventListener("touchstart", (e) => { const t = e.touches[0]; swipeStart = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!swipeStart) return;
  const t = e.changedTouches[0], dx = t.clientX - swipeStart.x, dy = t.clientY - swipeStart.y;
  const edge = swipeStart.x <= 24;
  swipeStart = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;   // not a clear sideways swipe
  const open = document.body.classList.contains("nav-open");
  if (open && dx < 0) document.body.classList.remove("nav-open");
  else if (!open && dx > 0 && edge && window.innerWidth < 900 && !$("app-view").hidden && !document.querySelector("dialog[open]")) document.body.classList.add("nav-open");
}, { passive: true });
$("events-list").addEventListener("click", onEventsListClick);
$("add-ticket-type").addEventListener("click", () => {
  readAllRows();
  eventsState.editing.ticketTypes.push({ id: newTicketTypeId(), name: "", price: 0, needsMembership: false });
  renderTicketTypes();
  renderQuestions();
});
$("add-question").addEventListener("click", () => {
  readAllRows();
  eventsState.editing.questions.push({ label: "", type: "text", options: [], required: false });
  renderQuestions();
});
$("ev-ticket-types").addEventListener("click", onRepeatClick);
$("ev-ticket-types").addEventListener("change", onTicketTypeTyped);
$("ev-questions").addEventListener("click", onRepeatClick);
$("ev-questions").addEventListener("change", onQuestionTypeChange);
$("ev-image-file").addEventListener("change", onImagePicked);
$("ev-image-pick").addEventListener("click", togglePreviousImages);
$("ev-image-grid").addEventListener("click", onPreviousImageClick);
$("event-form").addEventListener("submit", (ev) => { ev.preventDefault(); saveEvent(false); });
$("save-publish-button").addEventListener("click", () => saveEvent(true));
const previewButton = document.createElement("button");
previewButton.type = "button";
previewButton.id = "event-preview-button";
previewButton.className = "secondary";
previewButton.textContent = T.eventPreview;
previewButton.addEventListener("click", previewEvent);
$("save-draft-button").before(previewButton);
