// CSS Exec Portal — Payments tab (Finance): match e-transfers to orders, mark paid, refund.

const payState = { eventId: "", data: null, filter: "awaiting", q: "", selected: new Set(), timer: null };
const ORDERS_PAGE = 50;

async function openPaymentsTab() {
  if (!eventsState.loaded) await loadEvents();
  const events = activeEvents();
  const select = $("pay-event");
  if (!events.length) {
    select.innerHTML = "";
    $("pay-status").textContent = T.noEventsForPayments;
    return;
  }
  if (!payState.eventId || !events.some((e) => e.id === payState.eventId)) payState.eventId = events[0].id;
  select.innerHTML = events.map((e) =>
    `<option value="${e.id}" ${e.id === payState.eventId ? "selected" : ""}>${escapeHtml(e.name)} (${escapeHtml(e.date)})</option>`).join("");
  loadOrders();
}

/**
 * One page of orders at a time (the server filters and searches). `append` = the "Show more" button.
 * A plain reload (after an action) asks for as many as are already on screen, so the list doesn't jump back to the top.
 */
let ordersCounter = 0;
async function loadOrders(append, background) {
  const mine = ++ordersCounter;
  const have = payState.data ? payState.data.orders.length : 0;
  if (!background) $("pay-status").textContent = T.loadingOrders;
  const reply = await (background ? apiRequest : api)("listOrders", {
    eventId: payState.eventId, filter: payState.filter === "waitlist" ? "awaiting" : payState.filter, q: payState.q,
    offset: append ? have : 0, limit: append ? ORDERS_PAGE : Math.min(200, Math.max(ORDERS_PAGE, have))
  });
  if (mine !== ordersCounter) return;   // a newer request already started
  if (!reply.ok) return background ? undefined : handleEventError(reply, $("pay-status"));   // a failed quiet check just waits for the next one
  if (append && payState.data) reply.orders = payState.data.orders.concat(reply.orders);
  payState.data = reply;
  // keep only ticks for orders that are still waiting for payment
  payState.selected = new Set([...payState.selected].filter((id) => reply.orders.some((o) => o.id === id && o.status === "awaiting")));
  renderOrders();
}

// ---- Background refresh while doors are open: the list reloads itself every 30 s (no panda on this tab) ----
const PAY_LIVE_MS = 30000;

function payDoorsOpen() {
  const found = eventsState.events.find((e) => e.id === payState.eventId);
  return !!(found ? found.entryOpen : payState.data && payState.data.event && payState.data.event.entryOpen);
}

setInterval(() => {
  const idle = state.token && !$("app-view").hidden && !$("tab-payments").hidden && !document.hidden;
  // Skip a round while a request is running, a dialog is open, or the Waitlist chip is showing (it has its own loader).
  if (!idle || !payDoorsOpen() || !payState.data || payState.filter === "waitlist" || document.querySelector("dialog[open]")) return;
  if (document.querySelector("#orders button:disabled")) return;
  loadOrders(false, true);
}, PAY_LIVE_MS);

function renderOrders() {
  const data = payState.data;
  if (!data) return;
  const awaiting = data.counts.awaiting;
  $("pay-summary").textContent = T.paySummary(data.paidTickets, data.event.capacity ? ` / ${data.event.capacity}` : "", awaiting) +
    T.payMoney(dollars(data.money.received), dollars(data.money.received + data.money.awaiting));

  $("pay-unsent").hidden = !data.unsentEmails;
  $("pay-unsent").innerHTML = data.unsentEmails
    ? `<span>${T.unsentEmails(data.unsentEmails, data.emailsLeftToday)}</span><button class="link" id="send-unsent">${T.sendNow}</button>` : "";

  if (payState.filter === "waitlist") {   // the Waitlist chip swaps the orders list for the waitlist (waitlist.js)
    renderPayTiles();
    renderFinanceExtras([]);
    $("orders-more").hidden = true;
    $("pay-status").textContent = "";
    return renderWaitlist();
  }
  const list = data.orders;   // the server already filtered and searched
  $("pay-status").textContent = (list.length ? T.orderCountOf(list.length, data.total) : T.noOrders) + (data.counts.needsRepair ? " · " + T.repairNote(data.counts.needsRepair) : "");
  $("orders-more").hidden = !data.hasMore;
  $("orders").innerHTML = list.map(orderCard).join("");
  renderPayTiles();
  renderFinanceExtras(list);
}

function orderCard(o) {
  const statusText = { awaiting: T.statusAwaiting, paid: T.statusPaid, refunded: T.statusRefunded, cancelled: T.statusCancelled }[o.status] || o.status;
  const statusClass = { awaiting: "warn", paid: "good" }[o.status] || "neutral";
  return `
    <li class="card order" data-order="${o.id}">
      <div class="o-code">
        <span class="order-code">${o.status === "awaiting" ? `<input type="checkbox" class="pick" data-pick="${o.id}" ${payState.selected.has(o.id) ? "checked" : ""} aria-label="${T.pickOrder}"> ` : ""}${escapeHtml(o.code)}</span>
        <span class="o-when">${T.registered} ${escapeHtml(shortTime(o.createdAt))}</span>
      </div>
      <div class="o-who order-meta">
        <span><strong>${escapeHtml(o.payerName)}</strong> · ${escapeHtml(o.payerEmail)}</span>
        ${o.etransferName ? `<span>${T.etransferNameLabel}: <strong>${escapeHtml(o.etransferName)}</strong></span>` : ""}
        ${o.status === "paid" && o.paidBy ? `<span>${escapeHtml(T.paidByLabel(o.paidBy, shortTime(o.paidAt)))}</span>` : ""}
        ${o.notes ? `<span>${escapeHtml(o.notes)}</span>` : ""}
        ${o.needsRepair ? `<span class="flag">⚠ ${escapeHtml(T.needsRepair)}</span>` : ""}
        ${o.cancelRequestedAt ? `<span class="flag">${escapeHtml(T.cancelRequestedNote(o.cancelRequestedBy || o.payerName, shortTime(o.cancelRequestedAt)))}</span>` : ""}
      </div>
      <ul class="order-tickets o-tickets">${o.tickets.map((t) => `
        <li>${escapeHtml(t.name)} · ${escapeHtml(t.ticketType)} ${money(t.price)}
          ${t.ucid ? ` · UCID ${escapeHtml(t.ucid)}` : ""}${t.memberId ? ` · ${escapeHtml(t.memberId)}` : ""}
          ${Object.entries(t.answers || {}).map(([k, v]) => ` · ${escapeHtml(k)}: ${escapeHtml(v)}`).join("")}
          ${t.status === "paid" ? ` · <a class="link" target="_blank" rel="noopener" href="${ticketUrl(t)}">${T.openTicket}</a>` : ""}
          ${t.status === "paid" || t.status === "awaiting" ? ` · <button class="link" data-edit-ticket="${t.id}">${T.editPerson}</button>` : ""}
          ${t.checkedInAt ? ` · ${T.checkedInMark}` : ""}${stoppedTicketMark(o, t)}${t.emailedAt && !t.emailedAt.startsWith("test") && !t.emailedAt.startsWith("claim:") ? ` · ${T.emailedMark}` : ""}
          ${t.flag ? `<br><span class="flag">${escapeHtml(t.flag)}</span>` : ""}</li>`).join("")}
      </ul>
      <div class="o-money">${moneyLines(o)}</div>
      <div class="o-total"><span class="order-total">${money(o.total)}</span><span class="pill ${statusClass}">${statusText}</span></div>
      <div class="order-actions o-actions">
        ${o.status === "awaiting" ? `<button class="primary" data-act="pay">${o.received > 0 ? T.btnRecordRest(dollars(o.stillDue)) : T.markPaid(money(o.total))}</button>` : ""}
        ${o.needsRepair ? `<button class="primary" data-act="repair">${T.repairOrder}</button>` : ""}
        ${o.status === "refunded" || o.status === "cancelled" ? `<button class="link" data-act="restore">${T.restoreOrder}</button>` : ""}
        ${o.status === "paid" ? `<button class="link" data-act="resend">${T.resend}</button>` : ""}
        ${o.cancelRequestedAt ? `<button class="link" data-act="dismiss">${T.dismissRequest}</button>` : ""}
        ${o.status === "paid" || o.status === "awaiting" ? `<button class="link danger" data-act="invalidate">${o.status === "paid" ? T.btnInvalidate : T.btnCancelReg}</button>` : ""}
        <span class="order-result"></span>
      </div>
    </li>`;
}

/** The four numbers Finance looks at first. */
function renderPayTiles() {
  const d = payState.data;
  const awaiting = d.counts.awaiting;
  const overdue = d.counts.overdue;
  const cap = d.event.capacity ? ` / ${d.event.capacity}` : "";
  $("pay-tiles").innerHTML =
    statTile(T.tileReceived, dollars(d.money.received), T.tilePaidCount(d.paidTickets)) +
    statTile(T.tileStillToCome, dollars(d.money.awaiting), T.tileOrdersAwaiting(awaiting)) +
    statTile(T.tileOverdue, overdue, T.tileOverdueNote(d.reminderHours || 48), overdue > 0) +
    statTile(T.tileSpots, `${d.spotsTaken}${cap}`, d.event.capacity ? T.tileSpotsNote(Math.max(d.event.capacity - d.spotsTaken, 0)) : "");
}

function editTicket(button) {
  const order = payState.data.orders.find((o) => o.tickets.some((t) => t.id === button.dataset.editTicket));
  const ticket = order.tickets.find((t) => t.id === button.dataset.editTicket);
  openEditDialog({ ticket, order, event: payState.data.event }, (message) => {
    showToast(message);
    loadOrders();
  });
}

async function onOrdersClick(event) {
  if (event.target.closest("[data-wl-act]")) return onWaitlistClick(event);
  const edit = event.target.closest("button[data-edit-ticket]");
  if (edit) return editTicket(edit);
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const card = button.closest(".order");
  const order = payState.data.orders.find((o) => o.id === card.dataset.order);
  const result = card.querySelector(".order-result");
  const siteUrl = new URL(PUBLIC_SITE_URL, location.href).href;
  let reply;

  // These open their own windows (money.js): recording a payment, invalidating tickets, recording a refund.
  const act = button.dataset.act;
  if (act === "pay") return openPayDialog(order);
  if (act === "invalidate") return openInvalidateDialog(order);
  if (act === "recordrefund") return openRefundDialog(order);
  if (act === "histrefund") return markAlreadyReturned(order);
  if (act === "putback") return putTicketBack(order, button.dataset.ticket);

  if (button.dataset.act === "repair") {
    button.disabled = true;
    reply = await api("markOrderPaid", { orderId: order.id, siteUrl });   // an already-paid order: finishes tickets and emails that were left undone
    if (reply.ok) result.textContent = T.repaired(reply.repaired || 0, reply.emailsSent);
  }

  if (button.dataset.act === "restore") {
    if (!(await askConfirm(T.confirmRestoreOrder(order.code, order.status), T.restoreOrder))) return;
    button.disabled = true;
    reply = await api("restoreOrder", { orderId: order.id });
    if (!reply.ok && reply.error === "OVER_CAPACITY") {
      if (!(await askConfirm(T.restoreOverLimit(reply.message), T.restoreOrder))) { button.disabled = false; return; }
      reply = await api("restoreOrder", { orderId: order.id, force: true });
    }
    if (reply.ok) result.textContent = reply.status === "paid" ? T.restoredPaid : T.restoredOrder;
  }

  if (button.dataset.act === "dismiss") {
    button.disabled = true;
    reply = await api("dismissCancelRequest", { orderId: order.id });
    if (reply.ok) result.textContent = T.requestDismissed;
  }

  if (button.dataset.act === "resend") {
    button.disabled = true;
    reply = await api("resendTickets", { orderId: order.id, siteUrl });
    if (reply.ok) result.textContent = T.resent(reply.emailsSent);
  }

  if (!reply.ok) {
    button.disabled = false;
    return handleEventError(reply, result);
  }
  setTimeout(loadOrders, button.dataset.act === "restore" ? 0 : 1800);
  eventsState.loaded = false;   // counts on the Events tab changed
}

async function sendUnsent() {
  const waiting = payState.data.unsentEmails;
  const left = payState.data.emailsLeftToday;
  const suggested = left >= 0 ? Math.min(waiting, left) : waiting;
  const typed = prompt(T.sendHowMany(waiting, left), String(suggested));
  if (typed === null) return;
  const count = Math.floor(Number(typed));
  if (!(count >= 1)) return alert(T.sendHowManyBad);
  $("pay-unsent").textContent = T.saving;
  const reply = await api("sendPendingEmails", { count });
  if (!reply.ok) return handleEventError(reply, $("pay-unsent"));
  await loadOrders();
  showToast(T.sentSome(reply.emailsSent, reply.emailsWaiting), "success");
}

function ticketUrl(t) {
  return new URL(`ticket.html?t=${encodeURIComponent(t.secret)}`, new URL(PUBLIC_SITE_URL, location.href)).href;
}

function shortTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---- Wire up ----------------------------------------------------------------

$("pay-event").addEventListener("change", () => { payState.eventId = $("pay-event").value; loadOrders(); });
$("pay-search").addEventListener("input", () => {
  clearTimeout(payState.timer);
  payState.timer = setTimeout(() => { payState.q = $("pay-search").value.trim(); loadOrders(); }, 350);
});
$("orders-more").addEventListener("click", () => loadOrders(true));
$("pay-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  payState.filter = chip.dataset.filter;
  payState.selected.clear();
  document.querySelectorAll("#pay-filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  loadOrders();
});
$("orders").addEventListener("click", onOrdersClick);
$("pay-unsent").addEventListener("click", (e) => { if (e.target.id === "send-unsent") sendUnsent(); });
