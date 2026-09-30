// CSS Exec Portal — Attendees: one event's numbers, question answers and everyone registered.

const attState = { event: null, data: null, filter: "active" };

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

async function loadAttendees() {
  $("detail-status").textContent = T.attLoading;
  const reply = await api("eventSummary", { eventId: attState.event.id });
  if (!reply.ok) return handleEventError(reply, $("detail-status"));
  $("detail-status").textContent = "";
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

function matchesFilter(a) {
  switch (attState.filter) {
    case "active": return a.status === "paid" || a.status === "awaiting";
    case "paid": return a.status === "paid";
    case "awaiting": return a.status === "awaiting";
    case "inside": return !!a.checkedInAt && (a.status === "paid" || a.status === "awaiting");
    case "notArrived": return a.status === "paid" && !a.checkedInAt;
    case "flagged": return !!a.flag && (a.status === "paid" || a.status === "awaiting");
    case "closed": return a.status === "refunded" || a.status === "cancelled";
    default: return true;
  }
}

function renderAttendees() {
  if (!attState.data) return;
  const q = $("att-search").value.trim().toLowerCase();
  const sort = $("att-sort").value;
  const list = attState.data.attendees.filter(matchesFilter).filter((a) => !q ||
    [a.name, a.email, a.ucid, a.memberId, a.order.code, a.order.etransferName, a.order.payerName]
      .some((v) => String(v || "").toLowerCase().includes(q)));
  list.sort((a, b) => sort === "type" ? a.ticketType.localeCompare(b.ticketType) || a.name.localeCompare(b.name)
    : sort === "newest" ? String(b.createdAt).localeCompare(String(a.createdAt))
    : a.name.localeCompare(b.name));

  $("att-count").textContent = list.length ? T.attCount(list.length) : T.attNone;
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
$("detail-refresh").addEventListener("click", loadAttendees);
$("att-search").addEventListener("input", renderAttendees);
$("att-sort").addEventListener("change", renderAttendees);
$("att-list").addEventListener("click", onAttendeeClick);
$("att-filters").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  attState.filter = chip.dataset.filter;
  document.querySelectorAll("#att-filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderAttendees();
});
