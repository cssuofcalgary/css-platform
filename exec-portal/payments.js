// CSS Exec Portal — Payments tab (Finance): match e-transfers to orders, mark paid, refund.

const payState = { eventId: "", data: null, filter: "awaiting" };

async function openPaymentsTab() {
  if (!eventsState.loaded) await loadEvents();
  const events = eventsState.events.filter((e) => e.status !== "draft");
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

async function loadOrders() {
  $("pay-status").textContent = T.loadingOrders;
  const reply = await api("listOrders", { eventId: payState.eventId });
  if (!reply.ok) return handleEventError(reply, $("pay-status"));
  payState.data = reply;
  renderOrders();
}

function renderOrders() {
  const data = payState.data;
  if (!data) return;
  const awaiting = data.orders.filter((o) => o.status === "awaiting").length;
  $("pay-summary").textContent = T.paySummary(data.spotsTaken, data.event.capacity ? ` / ${data.event.capacity}` : "", awaiting);

  $("pay-unsent").hidden = !data.unsentEmails;
  $("pay-unsent").innerHTML = data.unsentEmails
    ? `<span>${T.unsentEmails(data.unsentEmails)}</span><button class="link" id="send-unsent">${T.sendNow}</button>` : "";

  const q = $("pay-search").value.trim().toLowerCase();
  const list = data.orders.filter((o) => {
    if (payState.filter === "awaiting" && o.status !== "awaiting") return false;
    if (payState.filter === "paid" && o.status !== "paid") return false;
    if (payState.filter === "closed" && o.status !== "refunded" && o.status !== "cancelled") return false;
    if (!q) return true;
    return [o.code, o.payerName, o.payerEmail, o.etransferName, ...o.tickets.map((t) => t.name)]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });
  $("pay-status").textContent = list.length ? T.orderCount(list.length) : T.noOrders;
  $("orders").innerHTML = list.map(orderCard).join("");
}

function orderCard(o) {
  const statusText = { awaiting: T.statusAwaiting, paid: T.statusPaid, refunded: T.statusRefunded, cancelled: T.statusCancelled }[o.status] || o.status;
  const statusClass = { awaiting: "warn", paid: "good" }[o.status] || "neutral";
  return `
    <li class="card order" data-order="${o.id}">
      <div class="order-head">
        <span class="order-code">${escapeHtml(o.code)}</span>
        <span><span class="pill ${statusClass}">${statusText}</span> <span class="order-total">${money(o.total)}</span></span>
      </div>
      <div class="order-meta">
        <span><strong>${escapeHtml(o.payerName)}</strong> · ${escapeHtml(o.payerEmail)}</span>
        ${o.etransferName ? `<span>${T.etransferNameLabel}: <strong>${escapeHtml(o.etransferName)}</strong></span>` : ""}
        <span>${T.registered} ${escapeHtml(shortTime(o.createdAt))}</span>
        ${o.status === "paid" && o.paidBy ? `<span>${escapeHtml(T.paidByLabel(o.paidBy, shortTime(o.paidAt)))}</span>` : ""}
        ${o.notes ? `<span>${escapeHtml(o.notes)}</span>` : ""}
      </div>
      <ul class="order-tickets">${o.tickets.map((t) => `
        <li>${escapeHtml(t.name)} · ${escapeHtml(t.ticketType)} ${money(t.price)}
          ${t.ucid ? ` · UCID ${escapeHtml(t.ucid)}` : ""}${t.memberId ? ` · ${escapeHtml(t.memberId)}` : ""}
          ${Object.entries(t.answers || {}).map(([k, v]) => ` · ${escapeHtml(k)}: ${escapeHtml(v)}`).join("")}
          ${t.status === "paid" ? ` · <a class="link" target="_blank" rel="noopener" href="${ticketUrl(t)}">${T.openTicket}</a>` : ""}
          ${t.checkedInAt ? ` · ✅ ${T.checkedInMark}` : ""}${t.emailedAt && !t.emailedAt.startsWith("test") ? ` · ✉ ${T.emailedMark}` : ""}
          ${t.flag ? `<br><span class="flag">⚠ ${escapeHtml(t.flag)}</span>` : ""}</li>`).join("")}
      </ul>
      <div class="order-actions">
        ${o.status === "awaiting" ? `<button class="primary" data-act="paid">${T.markPaid(money(o.total))}</button>` : ""}
        ${o.status === "paid" ? `<button class="link" data-act="resend">${T.resend}</button>` : ""}
        ${o.status === "paid" || o.status === "awaiting" ? `<button class="link danger" data-act="refund">${T.refund}</button>` : ""}
        <span class="order-result"></span>
      </div>
    </li>`;
}

async function onOrdersClick(event) {
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
$("pay-search").addEventListener("input", renderOrders);
$("pay-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  payState.filter = chip.dataset.filter;
  document.querySelectorAll("#pay-filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderOrders();
});
$("orders").addEventListener("click", onOrdersClick);
$("pay-unsent").addEventListener("click", (e) => { if (e.target.id === "send-unsent") sendUnsent(); });
