// CSS Exec Portal — Attendees: one event's numbers, question answers and everyone registered.

const attState = { event: null, data: null, filter: "active", timer: null };
const ATT_PAGE = 50;

async function openAttendees(event) {
  attState.event = event;
  attState.data = null;
  attState.filter = "active";
  document.querySelectorAll("#att-filters .chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === "active"));
  $("att-search").value = "";
  $("detail-title").textContent = event.name;
  $("detail-tiles").innerHTML = "";
  $("detail-types").innerHTML = "";
  $("detail-questions").innerHTML = "";
  $("att-list").innerHTML = "";
  $("att-count").textContent = "";
  $("events-list-view").hidden = true;
  $("event-editor-view").hidden = true;
  $("event-detail-view").hidden = false;
  window.scrollTo(0, 0);
  await loadAttendees();
}

/** One page of the list at a time (the server filters, searches and sorts). `append` = the "Show more" button. */
let attCounter = 0;
async function loadAttendees(append) {
  const mine = ++attCounter;
  const have = attState.data ? attState.data.attendees.length : 0;
  $("detail-status").textContent = T.attLoading;
  const reply = await api("eventSummary", {
    eventId: attState.event.id, filter: attState.filter, q: $("att-search").value.trim(), sort: $("att-sort").value,
    offset: append ? have : 0, limit: append ? ATT_PAGE : Math.min(500, Math.max(ATT_PAGE, have))
  });
  if (mine !== attCounter) return;
  if (!reply.ok) return handleEventError(reply, $("detail-status"));
  $("detail-status").textContent = "";
  if (append && attState.data) reply.attendees = attState.data.attendees.concat(reply.attendees);
  attState.data = reply;
  renderSummary();
  renderAttendees();
}

function renderSummary() {
  const d = attState.data;
  const t = d.totals;
  const tile = statTile;
  const cap = d.event.capacity ? ` / ${d.event.capacity}` : "";
  $("detail-tiles").innerHTML = [
    tile(T.tileRegistered, t.registered),
    tile(T.tilePaid, `${t.paid}${cap}`),
    tile(T.tileAwaiting, t.awaiting),
    tile(T.tileInside, t.checkedIn),
    tile(T.tileNotArrived, t.notArrived),
    d.spotsLeft === null ? "" : tile(T.tileSpotsLeft, d.spotsLeft),
    tile(T.tileReceived, money(d.money.received)),
    tile(T.tileWaiting, money(d.money.awaiting)),
    t.flagged ? tile(T.tileFlagged, t.flagged) : ""
  ].join("");

  $("detail-types").innerHTML = d.byType.length ? `<h3 class="section-title">${T.byTypeTitle}</h3><ul class="plain-list">${d.byType.map((b) =>
    `<li><strong>${escapeHtml(b.name)}</strong> <span class="muted">${T.byTypeLine(b.paid, b.awaiting, b.checkedIn)}</span></li>`).join("")}</ul>` : "";

  $("detail-questions").innerHTML = d.questions.length ? `<h3 class="section-title">${T.answersTitle}</h3>${d.questions.map((q) => `
    <div class="answer-block"><div class="answer-q">${escapeHtml(q.label)}</div>
      ${q.answers.length ? `<ul class="plain-list">${q.answers.map((a) =>
        `<li><strong>${escapeHtml(a.answer)}</strong> <span class="muted">${T.answersLine(a.paid, a.awaiting)}</span></li>`).join("")}</ul>`
        : `<div class="muted small">${T.noAnswers}</div>`}
    </div>`).join("")}` : "";
}

function renderAttendees() {
  if (!attState.data) return;
  const list = attState.data.attendees;   // already filtered, searched and sorted by the server
  $("att-count").textContent = list.length ? T.attCountOf(list.length, attState.data.attTotal) : T.attNone;
  $("att-more").hidden = !attState.data.attHasMore;
  $("att-list").innerHTML = list.map(attendeeCard).join("");
}

function attendeeCard(a) {
  const statusText = { awaiting: T.statusAwaiting, paid: T.statusPaid, refunded: T.statusRefunded, cancelled: T.statusCancelled }[a.status] || a.status;
  const statusClass = { awaiting: "warn", paid: "good" }[a.status] || "neutral";
  const answers = Object.entries(a.answers || {}).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join(" · ");
  const editable = a.status === "paid" || a.status === "awaiting";
  return `
    <li class="card att">
      <div class="att-main">
        <div><strong>${escapeHtml(a.name)}</strong> · ${escapeHtml(a.ticketType)} ${money(a.price)}
          <span class="pill ${statusClass}">${statusText}</span>${a.checkedInAt ? ` <span class="pill good">✓ ${escapeHtml(T.insideMark(shortTime(a.checkedInAt)))}</span>` : ""}</div>
        <div class="sub">${escapeHtml(a.email || "")}${a.ucid ? " · UCID " + escapeHtml(a.ucid) : ""}${a.memberId ? " · " + escapeHtml(a.memberId) : ""} · ${escapeHtml(a.order.code || "")}</div>
        ${answers ? `<div class="sub">${answers}</div>` : ""}
        ${a.flag ? `<span class="flag">⚠ ${escapeHtml(a.flag)}</span>` : ""}
      </div>
      ${editable ? `<button class="link" data-att-edit="${a.id}">${T.editPerson}</button>` : ""}
    </li>`;
}

function onAttendeeClick(event) {
  const button = event.target.closest("button[data-att-edit]");
  if (!button) return;
  const a = attState.data.attendees.find((x) => x.id === button.dataset.attEdit);
  openEditDialog({ ticket: a, order: a.order, event: attState.data.event }, (message) => {
    showToast(message);
    eventsState.loaded = false;   // counts on the Events list are out of date now
    loadAttendees();
  });
}

$("detail-back-button").addEventListener("click", showEventsList);
$("detail-refresh").addEventListener("click", () => loadAttendees());
$("att-search").addEventListener("input", () => { clearTimeout(attState.timer); attState.timer = setTimeout(() => loadAttendees(), 350); });
$("att-sort").addEventListener("change", () => loadAttendees());
$("att-more").addEventListener("click", () => loadAttendees(true));
$("att-list").addEventListener("click", onAttendeeClick);
$("att-filters").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  attState.filter = chip.dataset.filter;
  document.querySelectorAll("#att-filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  loadAttendees();
});

// ---- Download the list (opens in Excel / Google Sheets) -------------------------------

/** A spreadsheet treats cells starting with = + - @ as formulas; a leading quote keeps them plain text. */
function csvCell(value) {
  let text = String(value === undefined || value === null ? "" : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function attendeesCsv(data) {
  const questions = data.event.questions.map((q) => q.label);
  const head = ["Name", "Email", "UCID", "Member ID", "Ticket", "Price", "Status", "Checked in", "Checked in by", "Order code", "Order total", "Payer", "E-transfer name", "Flag", "Notes", ...questions];
  const rows = data.attendees.map((a) => [
    a.name, a.email, a.ucid, a.memberId, a.ticketType, a.price, a.status, a.checkedInAt, a.checkedInBy,
    a.order.code, a.order.total, a.order.payerName, a.order.etransferName, a.flag, a.order.notes,
    ...questions.map((label) => (a.answers || {})[label] || "")
  ]);
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

async function downloadAttendees() {
  if (!attState.data) return showToast(T.attDownloadNone);
  const button = $("detail-csv");
  button.disabled = true;
  const all = await api("eventSummary", { eventId: attState.event.id, filter: "all", full: true });   // everyone, not just the page on screen
  button.disabled = false;
  if (!all.ok) return handleEventError(all, $("detail-status"));
  if (!all.attendees.length) return showToast(T.attDownloadNone);
  const name = `${all.event.name}-${all.event.date || ""}`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([attendeesCsv(all)], { type: "text/csv;charset=utf-8" }));
  link.download = `${name || "attendees"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

$("detail-csv").addEventListener("click", downloadAttendees);
