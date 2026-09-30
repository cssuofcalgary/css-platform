// CSS Exec Portal — Events tab: list, create, edit, publish.

const eventsState = { events: [], editing: null, loaded: false };

// ---- Tabs -------------------------------------------------------------------

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("tab-members").hidden = name !== "members";
  $("tab-events").hidden = name !== "events";
  $("tab-payments").hidden = name !== "payments";
  $("tab-door").hidden = name !== "door";
  if (name !== "door" && doorState.scanner) stopCamera();
  if (name === "events") { showEventsList(); if (!eventsState.loaded) loadEvents(); }
  if (name === "payments") openPaymentsTab();
  if (name === "door") openDoorTab();
  if (name === "members") $("search-input").focus();
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
}

function renderEvents() {
  const list = eventsState.events;
  $("events-status").textContent = list.length ? "" : T.noEvents;
  $("events-list").innerHTML = list.map((e) => `
    <li class="card event-row">
      <div>
        <div class="name">${escapeHtml(e.name)}</div>
        <div class="sub">${escapeHtml(formatEventDate(e))}${e.location ? " · " + escapeHtml(e.location) : ""}</div>
        <div class="sub">${countsText(e)}</div>
        <div class="badges">${statusPill(e.status)}${e.ticketTypes.map((t) =>
          `<span class="pill neutral">${escapeHtml(t.name)} ${money(t.price)}</span>`).join("")}</div>
      </div>
      <div class="event-actions">
        <button class="link" data-action="edit" data-id="${e.id}">${T.edit}</button>
        ${e.status === "draft" ? `<button class="link" data-action="publish" data-id="${e.id}">${T.publish}</button>` : ""}
        ${e.status === "published" ? `<button class="link" data-action="close" data-id="${e.id}">${T.closeRegistration}</button>` : ""}
        ${e.status === "closed" ? `<button class="link" data-action="reopen" data-id="${e.id}">${T.reopen}</button>` : ""}
        ${e.status !== "draft" ? `<a class="link" target="_blank" rel="noopener" href="${publicLink(e)}">${T.viewPublicPage}</a>` : ""}
      </div>
    </li>`).join("");
}

async function onEventsListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const target = eventsState.events.find((e) => e.id === button.dataset.id);
  if (!target) return;
  if (button.dataset.action === "edit") return openEditor(target);

  const status = { publish: "published", close: "closed", reopen: "published" }[button.dataset.action];
  if (status === "published" && target.status === "draft" && !confirm(T.confirmPublish)) return;
  button.disabled = true;
  const reply = await api("setEventStatus", { eventId: target.id, status });
  if (!reply.ok) { button.disabled = false; return handleEventError(reply, $("events-status")); }
  target.status = status;
  renderEvents();
}

// ---- Editor -----------------------------------------------------------------

function openEditor(existing) {
  const e = existing || {
    name: "", date: "", startTime: "", endTime: "", location: "", description: "",
    capacity: null, capacityRule: "paid", imageFileId: "", imageUrl: "", codePrefix: "",
    ticketTypes: [{ name: "Member", price: 0, needsMembership: true }, { name: "Non-member", price: 0 }],
    questions: []
  };
  eventsState.editing = JSON.parse(JSON.stringify(e));

  $("editor-title").textContent = existing ? T.editEventTitle : T.newEventTitle;
  $("ev-name").value = e.name;
  $("ev-date").value = e.date;
  $("ev-start").value = e.startTime;
  $("ev-end").value = e.endTime;
  $("ev-location").value = e.location;
  $("ev-description").value = e.description;
  $("ev-capacity").value = e.capacity ?? "";
  $("ev-capacity-rule").value = e.capacityRule || "paid";
  $("ev-code-prefix").value = e.codePrefix || "";
  $("ev-image-file").value = "";
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
    codePrefix: $("ev-code-prefix").value
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
  el.textContent = errorText(reply);
}

function statusPill(status) {
  const cls = { draft: "neutral", published: "good", closed: "warn" }[status] || "neutral";
  const text = { draft: T.statusDraft, published: T.statusPublished, closed: T.statusClosed }[status] || status;
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
$("new-event-button").addEventListener("click", () => openEditor(null));
$("editor-back-button").addEventListener("click", showEventsList);
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
$("event-form").addEventListener("submit", (ev) => { ev.preventDefault(); saveEvent(false); });
$("save-publish-button").addEventListener("click", () => saveEvent(true));
