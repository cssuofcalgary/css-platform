// CSS Exec Portal — Finance extras on the Payments tab:
// "waiting too long" reminders, mark several orders paid at once, add a paid registration by hand.

const BULK_CHUNK = 8;   // orders per request, so each call stays quick

// ---- Waiting too long -------------------------------------------------------

/** Unpaid for longer than the reminder time, and not reminded since. (The server makes the final call.) */
function isOverdue(o) {
  if (o.status !== "awaiting" || !payState.data) return false;
  const cutoff = Date.now() - (payState.data.reminderHours || 48) * 3600 * 1000;
  if (new Date(o.createdAt).getTime() > cutoff) return false;
  if (!o.remindedAt) return true;
  const when = new Date(o.remindedAt).getTime();
  return !isNaN(when) && when <= cutoff;
}

function renderFinanceExtras(shown) {
  const data = payState.data;
  const overdue = data.counts.overdue;
  const chip = document.querySelector('#pay-filters [data-filter="overdue"]');
  chip.textContent = T.filterOverdue(overdue);
  const cancelChip = document.querySelector('#pay-filters [data-filter="cancelreq"]');
  cancelChip.textContent = T.filterCancelReq(data.counts.cancelRequests || 0);
  cancelChip.hidden = !data.counts.cancelRequests && payState.filter !== "cancelreq";
  const wl = data.waitlist || {};
  const waitChip = document.querySelector('#pay-filters [data-filter="waitlist"]');
  waitChip.textContent = T.filterWaitlist((wl.waiting || 0) + (wl.offered || 0));
  waitChip.hidden = !wl.enabled && !wl.waiting && !wl.offered && payState.filter !== "waitlist";

  const box = $("pay-overdue");
  box.hidden = !overdue;
  box.innerHTML = overdue
    ? `<span>${T.overdueNotice(overdue, data.reminderHours || 48)}</span><button class="link" id="send-reminders">${T.sendReminders}</button>` : "";

  // Bulk bar: tick orders, mark them all paid in one go
  const selected = data.orders.filter((o) => payState.selected.has(o.id));
  const pickable = shown.filter((o) => o.status === "awaiting");
  const bar = $("bulk-bar");
  bar.hidden = !pickable.length && !selected.length;
  bar.classList.toggle("idle", !selected.length);   // plain until something is ticked: the hint is an instruction, not a warning
  const total = selected.reduce((sum, o) => sum + o.total, 0);
  bar.innerHTML = `
    <span class="bulk-info">${selected.length ? T.bulkSelected(selected.length, money(total)) : T.bulkHint}</span>
    <span class="bulk-buttons">
      ${pickable.length ? `<button class="link" id="bulk-all">${T.bulkAll(pickable.length)}</button>` : ""}
      ${selected.length ? `<button class="link" id="bulk-clear">${T.bulkClear}</button>
      <button class="primary small-button" id="bulk-pay">${T.bulkPay(selected.length)}</button>` : ""}
    </span>`;
}

async function sendReminders() {
  const button = $("send-reminders");
  button.disabled = true;
  const dry = await api("sendReminders", { eventId: payState.eventId, dryRun: true });
  if (!dry.ok) { button.disabled = false; return handleEventError(dry, $("pay-status")); }
  if (!dry.due) { button.disabled = false; return showToast(T.remindersNone); }
  if (!confirm(T.confirmReminders(dry.toEmail, dry.due - dry.toEmail, dry.emailsLeftToday))) { button.disabled = false; return; }

  const reply = await api("sendReminders", { eventId: payState.eventId });
  button.disabled = false;
  if (!reply.ok) return handleEventError(reply, $("pay-status"));
  showToast(T.remindersSent(reply.sent, reply.failed));
  loadOrders();
}

// ---- Mark several paid ------------------------------------------------------

function onPick(event) {
  const box = event.target.closest("input[data-pick]");
  if (!box) return;
  if (box.checked) payState.selected.add(box.dataset.pick); else payState.selected.delete(box.dataset.pick);
  renderFinanceExtras(currentShownOrders());
}

/** The orders the list is showing right now (same filters as renderOrders). */
function currentShownOrders() {
  return [...document.querySelectorAll("#orders .order")]
    .map((card) => payState.data.orders.find((o) => o.id === card.dataset.order)).filter(Boolean);
}

async function markSelectedPaid() {
  const orders = payState.data.orders.filter((o) => payState.selected.has(o.id) && o.status === "awaiting");
  if (!orders.length) return;
  const total = orders.reduce((sum, o) => sum + o.total, 0);
  if (!confirm(T.confirmBulk(orders.length, money(total), orders.map((o) => `${o.code} ${money(o.total)}`).join("\n")))) return;

  $("bulk-bar").querySelectorAll("button").forEach((b) => { b.disabled = true; });
  const siteUrl = new URL(PUBLIC_SITE_URL, location.href).href;
  const done = [], skipped = [];
  let emails = 0, error = null;
  for (let i = 0; i < orders.length; i += BULK_CHUNK) {
    const ids = orders.slice(i, i + BULK_CHUNK).map((o) => o.id);
    const reply = await api("markOrdersPaid", { orderIds: ids, siteUrl });
    if (!reply.ok) { error = reply; break; }
    emails += reply.emailsSent;
    reply.results.forEach((r) => (r.ok ? done : skipped).push(r));
  }
  payState.selected.clear();
  eventsState.loaded = false;
  if (error) showToast(`${T.bulkDone(done.length, emails)} ${errorText(error)}`);
  else showToast(T.bulkDone(done.length, emails) + (skipped.length ? " " + T.bulkSkipped(skipped.map((r) => `${r.code}: ${r.message}`).join(" · ")) : ""));
  loadOrders();
}

// ---- Add a paid registration -------------------------------------------------

function openAddOrder() {
  const event = payState.data && payState.data.event;
  if (!event) return;
  $("add-type").innerHTML = event.ticketTypes.map((t) =>
    `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} · ${money(t.price)}</option>`).join("");
  $("add-answers").innerHTML = (event.questions || []).map((q, i) => {
    const input = q.type === "choice"
      ? `<select data-aq="${i}"><option value=""></option>${(q.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join("")}</select>`
      : `<input data-aq="${i}" maxlength="300">`;
    return `<label>${escapeHtml(q.label)}</label>${input}`;
  }).join("");
  ["add-name", "add-email", "add-ucid", "add-member", "add-etransfer", "add-notes"].forEach((id) => { $(id).value = ""; });
  $("add-title").textContent = T.addTitle(event.name);
  setAddError("");
  setAddBusy(false);
  $("add-dialog").showModal();
  $("add-name").focus();
}

async function onAddSubmit(e) {
  e.preventDefault();
  const event = payState.data.event;
  const answers = {};
  document.querySelectorAll("#add-answers [data-aq]").forEach((input) => {
    if (input.value.trim()) answers[event.questions[Number(input.dataset.aq)].id] = input.value;
  });
  const payload = {
    eventId: payState.eventId,
    order: {
      person: { name: $("add-name").value, email: $("add-email").value, ucid: $("add-ucid").value,
                memberId: $("add-member").value, ticketTypeId: $("add-type").value, answers },
      etransferName: $("add-etransfer").value, notes: $("add-notes").value
    },
    siteUrl: new URL(PUBLIC_SITE_URL, location.href).href
  };
  setAddBusy(true);
  let reply = await api("addOrder", payload);
  if (!reply.ok && reply.error === "OVER_CAPACITY" && confirm(T.overCapacity(reply.message))) {
    reply = await api("addOrder", { ...payload, force: true });
  }
  if (!reply.ok) {
    setAddBusy(false);
    if (reply.error === "NOT_LOGGED_IN") { $("add-dialog").close(); return handleEventError(reply, $("add-error")); }
    return setAddError(errorText(reply));
  }
  $("add-dialog").close();
  eventsState.loaded = false;
  showToast(T.added(reply.code, reply.emailsSent, reply.flag));
  loadOrders();
}

function setAddBusy(busy) {
  $("add-save").disabled = busy;
  $("add-save").textContent = busy ? T.editSaving : T.addSave;
}

function setAddError(text) {
  $("add-error").textContent = text;
  $("add-error").hidden = !text;
}

// ---- Wire up ----------------------------------------------------------------

$("orders").addEventListener("change", onPick);
$("pay-overdue").addEventListener("click", (e) => { if (e.target.id === "send-reminders") sendReminders(); });
$("bulk-bar").addEventListener("click", (e) => {
  if (e.target.id === "bulk-pay") markSelectedPaid();
  if (e.target.id === "bulk-clear") { payState.selected.clear(); renderOrders(); }
  if (e.target.id === "bulk-all") { currentShownOrders().filter((o) => o.status === "awaiting").forEach((o) => payState.selected.add(o.id)); renderOrders(); }
});
$("add-order-button").addEventListener("click", openAddOrder);
$("add-form").addEventListener("submit", onAddSubmit);
$("add-cancel").addEventListener("click", () => $("add-dialog").close());
