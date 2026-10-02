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
async function loadOrders(append) {
  const mine = ++ordersCounter;
  const have = payState.data ? payState.data.orders.length : 0;
  $("pay-status").textContent = T.loadingOrders;
  const reply = await api("listOrders", {
    eventId: payState.eventId, filter: payState.filter, q: payState.q,
    offset: append ? have : 0, limit: append ? ORDERS_PAGE : Math.min(200, Math.max(ORDERS_PAGE, have))
  });
  if (mine !== ordersCounter) return;   // a newer request already started
  if (!reply.ok) return handleEventError(reply, $("pay-status"));
  if (append && payState.data) reply.orders = payState.data.orders.concat(reply.orders);
  payState.data = reply;
  // keep only ticks for orders that are still waiting for payment
  payState.selected = new Set([...payState.selected].filter((id) => reply.orders.some((o) => o.id === id && o.status === "awaiting")));
  renderOrders();
}

function renderOrders() {
  const data = payState.data;
  if (!data) return;
  const awaiting = data.counts.awaiting;
  $("pay-summary").textContent = T.paySummary(data.spotsTaken, data.event.capacity ? ` / ${data.event.capacity}` : "", awaiting) +
    T.payMoney(money(data.money.received), money(data.money.received + data.money.awaiting));

  $("pay-unsent").hidden = !data.unsentEmails;
  $("pay-unsent").innerHTML = data.unsentEmails
    ? `<span>${T.unsentEmails(data.unsentEmails)}</span><button class="link" id="send-unsent">${T.sendNow}</button>` : "";

  const list = data.orders;   // the server already filtered and searched
  $("pay-status").textContent = list.length ? T.orderCountOf(list.length, data.total) : T.noOrders;
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
      </div>
      <ul class="order-tickets o-tickets">${o.tickets.map((t) => `
        <li>${escapeHtml(t.name)} · ${escapeHtml(t.ticketType)} ${money(t.price)}
          ${t.ucid ? ` · UCID ${escapeHtml(t.ucid)}` : ""}${t.memberId ? ` · ${escapeHtml(t.memberId)}` : ""}
          ${Object.entries(t.answers || {}).map(([k, v]) => ` · ${escapeHtml(k)}: ${escapeHtml(v)}`).join("")}
          ${t.status === "paid" ? ` · <a class="link" target="_blank" rel="noopener" href="${ticketUrl(t)}">${T.openTicket}</a>` : ""}
          ${t.status === "paid" || t.status === "awaiting" ? ` · <button class="link" data-edit-ticket="${t.id}">${T.editPerson}</button>` : ""}
          ${t.checkedInAt ? ` · ${T.checkedInMark}` : ""}${t.emailedAt && !t.emailedAt.startsWith("test") ? ` · ${T.emailedMark}` : ""}
          ${t.flag ? `<br><span class="flag">${escapeHtml(t.flag)}</span>` : ""}</li>`).join("")}
      </ul>
      <div class="o-total"><span class="order-total">${money(o.total)}</span><span class="pill ${statusClass}">${statusText}</span></div>
      <div class="order-actions o-actions">
        ${o.status === "awaiting" ? `<button class="primary" data-act="paid">${T.markPaid(money(o.total))}</button>` : ""}
        ${o.status === "paid" ? `<button class="link" data-act="resend">${T.resend}</button>` : ""}
        ${o.status === "paid" || o.status === "awaiting" ? `<button class="link danger" data-act="refund">${T.refund}</button>` : ""}
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
    statTile(T.tileReceived, money(d.money.received), T.tilePaidCount(d.spotsTaken)) +
    statTile(T.tileStillToCome, money(d.money.awaiting), T.tileOrdersAwaiting(awaiting)) +
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
  const edit = event.target.closest("button[data-edit-ticket]");
  if (edit) return editTicket(edit);
  const button = event.target.closest("button[data-act]");
  if (!button) return;
  const card = button.closest(".order");
  const order = payState.data.orders.find((o) => o.id === card.dataset.order);
  const result = card.querySelector(".order-result");
  const siteUrl = new URL(PUBLIC_SITE_URL, location.href).href;
  let reply;

  if (button.dataset.act === "paid") {
    const who = order.etransferName || order.payerName;
    if (!confirm(T.confirmPaid(money(order.total), order.code, who))) return;
    button.disabled = true;
    reply = await api("markOrderPaid", { orderId: order.id, siteUrl });
    if (!reply.ok && reply.error === "OVER_CAPACITY" && confirm(T.overCapacity(reply.message))) {
      reply = await api("markOrderPaid", { orderId: order.id, siteUrl, force: true });
    }
    if (reply.ok) result.textContent = T.markedPaid(reply.emailsSent, reply.emailsWaiting);
  }

  if (button.dataset.act === "refund") {
    if (!confirm(T.confirmRefund(order.code, order.payerName))) return;
    const reason = prompt(T.refundPrompt(order.code, order.status));
    if (reason === null) return;
    button.disabled = true;
    reply = await api("refundOrder", { orderId: order.id, reason });
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
  setTimeout(loadOrders, button.dataset.act === "refund" ? 0 : 1800);
  eventsState.loaded = false;   // counts on the Events tab changed
}

async function sendUnsent() {
  $("pay-unsent").textContent = T.saving;
  const reply = await api("sendPendingEmails");
  if (!reply.ok) return handleEventError(reply, $("pay-unsent"));
  loadOrders();
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
