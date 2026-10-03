// CSS Exec Portal — money on the Payments tab: recording an e-transfer (exact, short, too much, someone else's name,
// several orders, cancelled order, full event), cancelling or invalidating tickets, and recording refunds.
// The platform never moves money. It keeps track of what arrived, what is owed back, and what was returned.

// ---- What an order card shows about money ------------------------------------------------------

/** Lines under an order's name: part-payment, refund owed, refund returned. */
function moneyLines(o) {
  const lines = [];
  if (o.status === "awaiting" && o.received > 0) {
    lines.push(`<span class="flag">${escapeHtml(T.orderPartPaid(dollars(o.received), dollars(o.total), dollars(o.stillDue)))}</span>`);
  }
  const rf = o.refund || { state: "none", records: [] };
  if (rf.state === "owed") {
    lines.push(`<span class="refund-owed"><strong>${escapeHtml(T.refundOwedLine(dollars(rf.remaining), o.payerName))}</strong> ${escapeHtml(T.refundOwedNote)}
      <button class="primary small-button" data-act="recordrefund">${T.btnRecordRefund}</button></span>`);
  }
  rf.records.filter((r) => r.status === "returned").forEach((r) => {
    const last = r.returns[r.returns.length - 1] || {};
    lines.push(`<span class="muted">${escapeHtml(T.refundReturnedLine(dollars(r.returned), T.refundReturnedLast(last.date, last.by, last.method)))}</span>`);
  });
  if (rf.state === "unrecorded") {
    lines.push(`<span class="refund-unrecorded muted">${escapeHtml(T.refundUnrecordedLine)}
      <button class="link" data-act="histrefund">${T.btnAlreadyReturned}</button> · <button class="link" data-act="recordrefund">${T.btnRecordDetails}</button></span>`);
  }
  return lines.join("");
}

/** Chip + "Put back" next to a ticket that was cancelled or invalidated inside an order that is still live. */
function stoppedTicketMark(o, t) {
  if ((t.status !== "refunded" && t.status !== "cancelled") || (o.status !== "paid" && o.status !== "awaiting")) return "";
  return ` · <span class="pill neutral">${escapeHtml(T.ticketStopped[t.status])}</span> <button class="link" data-act="putback" data-ticket="${t.id}">${T.btnPutBack}</button>`;
}

function orderByCard(card) {
  return payState.data.orders.find((o) => o.id === card.dataset.order);
}

// ---- Record payment (one order from its card, or "a payment I can't match") --------------------

const payDlg = { orders: [], mode: "order", needFull: "", fullMessage: "" };

function payCents(n) { return Math.round((Number(n) || 0) * 100); }

function openPayDialog(order) {
  payDlg.mode = "order";
  payDlg.needFull = "";
  payDlg.orders = [orderEntry(order, true)];
  $("pay-title").textContent = T.payTitleOrder(order.code);
  $("pay-intro").textContent = T.payIntroOrder;
  $("pay-find-box").hidden = true;
  $("pay-amount").value = order.stillDue || order.total ? String(order.stillDue || order.total) : "";
  $("pay-sender").value = order.etransferName || "";
  $("pay-code").value = "";
  setPayError("");
  renderPayDialog();
  $("pay-dialog").showModal();
  $("pay-amount").focus();
  $("pay-amount").select();
}

function openFindDialog() {
  payDlg.mode = "find";
  payDlg.needFull = "";
  payDlg.orders = [];
  $("pay-title").textContent = T.payTitleFind;
  $("pay-intro").textContent = T.payIntroFind;
  $("pay-find-box").hidden = false;
  $("pay-amount").value = "";
  $("pay-sender").value = "";
  $("pay-code").value = "";
  $("pay-groups").innerHTML = "";
  setPayError("");
  renderPayDialog();
  $("pay-dialog").showModal();
  $("pay-amount").focus();
}

function orderEntry(o, checked) {
  return { id: o.id, code: o.code, payerName: o.payerName, status: o.status, stillDue: o.stillDue !== undefined ? o.stillDue : o.total, eventName: o.eventName || (payState.data ? payState.data.event.name : ""), reasons: o.reasons || [], checked: !!checked };
}

function checkedOrders() { return payDlg.orders.filter((o) => o.checked); }

function renderPayDialog() {
  $("pay-orders").innerHTML = payDlg.orders.map((o, i) => `
    <li><label class="check-row pay-order"><input type="checkbox" data-pay-i="${i}" ${o.checked ? "checked" : ""}>
      <span>${escapeHtml(T.payOrderLine(o.code, o.payerName, dollars(o.stillDue), o.eventName, o.status))}
      ${o.reasons.length ? `<small class="muted"> · ${escapeHtml(o.reasons.join(", "))}</small>` : ""}</span></label></li>`).join("");
  updatePayCompare();
}

/** What the amount means against the ticked orders, and which choices Finance has to make. */
function updatePayCompare() {
  const picked = checkedOrders();
  const amount = payCents($("pay-amount").value);
  const due = picked.reduce((sum, o) => sum + payCents(o.stillDue), 0);
  const closed = picked.filter((o) => o.status !== "awaiting");
  const box = $("pay-choices");
  const keep = {};   // keep a choice already made while the numbers change
  box.querySelectorAll("input[type=radio]:checked").forEach((r) => { keep[r.name] = r.value; });
  let html = "", compare = "", needs = [];

  if (!picked.length) compare = T.payPickOrders;
  else if (!(amount > 0)) compare = T.payCompareNone;
  else {
    const radios = (name, items) => `<div class="radio-group" role="radiogroup">${items.map(([value, label]) =>
      `<label class="check-row"><input type="radio" name="${name}" value="${value}" ${keep[name] === value ? "checked" : ""}> <span>${escapeHtml(label)}</span></label>`).join("")}</div>`;
    if (closed.length) {
      html += `<p><strong>${escapeHtml(T.payClosedLead(closed.map((o) => o.code).join(", ")))}</strong></p>` +
        radios("late", [["restore", T.payLateRestore], ["refund", T.payLateRefund]]);
      needs.push("late");
    }
    const refundingAll = (keep.late === "refund" && closed.length === picked.length) || keep.full === "refund";
    if (!refundingAll) {
      const diff = amount - due;
      if (diff === 0) compare = T.payExact(picked.length);
      else if (diff > 0) {
        compare = T.payOver(dollars(diff / 100));
        html += radios("over", [["refund", T.payOverRefund(dollars(diff / 100))], ["keep", T.payOverKeep]]);
        needs.push("over");
      } else {
        compare = T.payShort(dollars(-diff / 100));
        html += radios("short", [["wait", T.payShortWait(dollars(-diff / 100))], ["accept", T.payShortAccept]]);
        needs.push("short");
      }
    }
    if (payDlg.needFull) {
      html += `<p><strong>${escapeHtml(T.payFullLead)}</strong><br><span class="muted small">${escapeHtml(payDlg.fullMessage)}</span></p>` +
        radios("full", [["confirm", T.payFullConfirm], ["refund", T.payFullRefund]]);
      needs.push("full");
    }
  }
  $("pay-compare").textContent = compare;
  $("pay-compare").hidden = !compare;
  box.innerHTML = html;
  payDlg.needs = needs;
  $("pay-save").disabled = !picked.length || !(amount > 0);
}

function chosen(name) {
  const r = document.querySelector(`#pay-choices input[name="${name}"]:checked`);
  return r ? r.value : "";
}

async function submitPayment(e) {
  e.preventDefault();
  const picked = checkedOrders();
  const missing = (payDlg.needs || []).filter((n) => !chosen(n));
  if (missing.length) return setPayError(T.payChoose);
  const payload = {
    orderIds: picked.map((o) => o.id), amount: $("pay-amount").value, senderName: $("pay-sender").value,
    over: chosen("over"), short: chosen("short"), late: chosen("late"), full: chosen("full"),
    siteUrl: new URL(PUBLIC_SITE_URL, location.href).href
  };
  $("pay-save").disabled = true;
  $("pay-save").textContent = T.paySaving;
  const reply = await api("applyTransfer", payload);
  $("pay-save").textContent = T.paySubmit;
  if (!reply.ok && reply.error === "OVER_CAPACITY") {
    payDlg.needFull = "yes";
    payDlg.fullMessage = reply.message;
    updatePayCompare();
    $("pay-save").disabled = false;
    return setPayError(T.payChoose);
  }
  if (!reply.ok) {
    $("pay-save").disabled = false;
    if (reply.error === "NOT_LOGGED_IN") { $("pay-dialog").close(); return handleEventError(reply, $("pay-error")); }
    return setPayError(errorText(reply));
  }
  $("pay-dialog").close();
  eventsState.loaded = false;
  showToast(T.transferOutcome(reply), "success");
  loadOrders();
}

function setPayError(text) {
  $("pay-error").textContent = text;
  $("pay-error").hidden = !text;
}

async function runFindTransfer() {
  setPayError("");
  $("pay-find").disabled = true;
  $("pay-find").textContent = T.payFinding;
  const reply = await api("findTransfer", { amount: $("pay-amount").value, name: $("pay-sender").value, code: $("pay-code").value });
  $("pay-find").disabled = false;
  $("pay-find").textContent = T.payFindButton;
  if (!reply.ok) return setPayError(errorText(reply));
  payDlg.orders = reply.candidates.map((c) => orderEntry(c, false));
  const exact = payDlg.orders.filter((o) => o.reasons.indexOf("Code matches") !== -1);
  if (exact.length === 1) exact[0].checked = true;
  $("pay-groups").innerHTML = reply.groups.map((g, i) => `<p class="notice-box">${escapeHtml(T.payGroupSuggest(g.codes.join(" + ")))}
    <button type="button" class="link" data-pay-group="${i}">${T.payGroupSelect}</button></p>`).join("");
  payDlg.groups = reply.groups;
  if (!payDlg.orders.length && !reply.groups.length) setPayError(T.payNoMatches);
  renderPayDialog();
}

// ---- Cancel registration / invalidate tickets -------------------------------------------------

const invDlg = { order: null, refundEdited: false };

function openInvalidateDialog(order) {
  invDlg.order = order;
  invDlg.refundEdited = false;
  const paid = order.status === "paid";
  $("inv-title").textContent = paid ? T.invTitlePaid(order.code) : T.invTitleUnpaid(order.code);
  $("inv-intro").textContent = paid ? T.invIntroPaid : T.invIntroUnpaid;
  $("inv-partpaid").hidden = paid || !(order.received > 0);
  if (order.received > 0 && !paid) $("inv-partpaid").textContent = T.invIntroPartPaid(dollars(order.received));
  const live = order.tickets.filter((t) => t.status === "paid" || t.status === "awaiting");
  $("inv-tickets").innerHTML = live.map((t) => `
    <li><label class="check-row pay-order"><input type="checkbox" data-inv="${t.id}" ${t.checkedInAt ? "disabled" : ""}>
      <span>${escapeHtml(t.name)} · ${escapeHtml(t.ticketType)} ${money(t.price)}${t.status === "awaiting" ? "" : ""}
      ${t.checkedInAt ? `<small class="muted"> · ${escapeHtml(T.invCheckedIn)}</small>` : ""}</span></label></li>`).join("");
  $("inv-refund").value = "";
  $("inv-reason").value = "";
  setInvError("");
  updateInvalidate();
  $("invalidate-dialog").showModal();
}

function invChosen() {
  const ids = [...document.querySelectorAll("#inv-tickets input[data-inv]:checked")].map((i) => i.dataset.inv);
  return invDlg.order.tickets.filter((t) => ids.indexOf(t.id) !== -1);
}

function updateInvalidate() {
  const o = invDlg.order;
  const picked = invChosen();
  const paid = o.status === "paid";
  const live = o.tickets.filter((t) => t.status === "paid" || t.status === "awaiting");
  const whole = picked.length === live.length;
  const paidPicked = picked.filter((t) => t.status === "paid");
  const suggested = paid ? paidPicked.reduce((s, t) => s + payCents(t.price), 0) / 100 : (whole ? o.received || 0 : 0);
  const showRefund = suggested > 0 || (paid && picked.length > 0);
  $("inv-refund-box").hidden = !showRefund;
  if (!invDlg.refundEdited) $("inv-refund").value = suggested ? String(suggested) : (showRefund ? "0" : "");
  $("inv-save").disabled = !picked.length;
  $("inv-save").textContent = paid ? T.invConfirmPaid(picked.length) : T.invConfirmUnpaid(picked.length, whole);
}

async function submitInvalidate(e) {
  e.preventDefault();
  const picked = invChosen();
  if (!picked.length) return setInvError(T.invPickSome);
  $("inv-save").disabled = true;
  const payload = { orderId: invDlg.order.id, ticketIds: picked.map((t) => t.id), reason: $("inv-reason").value };
  if (!$("inv-refund-box").hidden) payload.refundAmount = $("inv-refund").value;
  const reply = await api("invalidateTickets", payload);
  if (!reply.ok) {
    $("inv-save").disabled = false;
    if (reply.error === "NOT_LOGGED_IN") { $("invalidate-dialog").close(); return handleEventError(reply, $("inv-error")); }
    return setInvError(errorText(reply));
  }
  $("invalidate-dialog").close();
  eventsState.loaded = false;
  showToast(T.invOutcome(reply), "success");
  loadOrders();
}

function setInvError(text) {
  $("inv-error").textContent = text;
  $("inv-error").hidden = !text;
}

// ---- Record a refund ---------------------------------------------------------------------------

const rfDlg = { order: null, record: null };

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function openRefundDialog(order) {
  const rf = order.refund;
  const open = rf.records.find((r) => r.status === "owed");
  rfDlg.order = order;
  rfDlg.record = open || null;   // none = an old refund with nothing written down
  $("rf-title").textContent = T.rfTitle(order.code);
  const owed = open ? open.remaining : order.received || order.total;
  $("rf-owed").textContent = T.rfOwedLine(dollars(owed), order.payerName, order.payerEmail) + (open && open.returned ? " " + T.rfPartLine(dollars(open.returned), dollars(open.remaining)) : "");
  $("rf-intro").textContent = T.rfIntro;
  $("rf-amount").value = String(owed);
  $("rf-method").value = "e-transfer";
  $("rf-date").value = localToday();
  $("rf-date").max = localToday();
  $("rf-by").value = state.name || "";
  $("rf-note").value = "";
  $("rf-unknown").hidden = !!open;
  $("rf-notowed").hidden = !open;
  setRfError("");
  $("refund-dialog").showModal();
  $("rf-amount").focus();
}

async function submitRefund(e) {
  e.preventDefault();
  $("rf-save").disabled = true;
  const reply = await api("recordRefund", {
    refundId: rfDlg.record ? rfDlg.record.id : undefined, orderId: rfDlg.order.id,
    amount: $("rf-amount").value, method: $("rf-method").value, date: $("rf-date").value, by: $("rf-by").value, note: $("rf-note").value
  });
  $("rf-save").disabled = false;
  if (!reply.ok) {
    if (reply.error === "NOT_LOGGED_IN") { $("refund-dialog").close(); return handleEventError(reply, $("rf-error")); }
    return setRfError(errorText(reply));
  }
  $("refund-dialog").close();
  showToast(T.rfRecorded(reply.remaining), "success");
  loadOrders();
}

async function markAlreadyReturned(order) {
  const reply = await api("recordRefund", { orderId: order.id, unknown: true });
  if (!reply.ok) return showToast(errorText(reply));
  showToast(T.rfRecorded(0));
  loadOrders();
}

async function refundNotOwed() {
  const reason = prompt(T.rfNotOwedPrompt);
  if (reason === null) return;
  const reply = await api("cancelRefund", { refundId: rfDlg.record.id, reason });
  if (!reply.ok) return setRfError(errorText(reply));
  $("refund-dialog").close();
  showToast(T.rfCancelled);
  loadOrders();
}

function setRfError(text) {
  $("rf-error").textContent = text;
  $("rf-error").hidden = !text;
}

// ---- Put a ticket back -------------------------------------------------------------------------

async function putTicketBack(order, ticketId) {
  const ticket = order.tickets.find((t) => t.id === ticketId);
  if (!(await askConfirm(T.confirmPutBack(ticket.name), T.btnPutBack))) return;
  let reply = await api("restoreTickets", { orderId: order.id, ticketIds: [ticketId] });
  if (!reply.ok && reply.error === "OVER_CAPACITY") {
    if (!(await askConfirm(T.restoreOverLimit(reply.message), T.btnPutBack))) return;
    reply = await api("restoreTickets", { orderId: order.id, ticketIds: [ticketId], force: true });
  }
  if (!reply.ok) return showToast(errorText(reply));
  eventsState.loaded = false;
  showToast(T.putBackDone, "success");
  loadOrders();
}

// ---- Wire up -----------------------------------------------------------------------------------

$("pay-form").addEventListener("submit", submitPayment);
$("pay-cancel").addEventListener("click", () => $("pay-dialog").close());
$("pay-find").addEventListener("click", runFindTransfer);
$("pay-amount").addEventListener("input", updatePayCompare);
$("pay-orders").addEventListener("change", (e) => {
  const box = e.target.closest("input[data-pay-i]");
  if (!box) return;
  payDlg.orders[Number(box.dataset.payI)].checked = box.checked;
  updatePayCompare();
});
$("pay-choices").addEventListener("change", updatePayCompare);
$("pay-groups").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay-group]");
  if (!b) return;
  const g = payDlg.groups[Number(b.dataset.payGroup)];
  payDlg.orders.forEach((o) => { o.checked = g.orderIds.indexOf(o.id) !== -1; });
  renderPayDialog();
});

$("invalidate-form").addEventListener("submit", submitInvalidate);
$("inv-cancel").addEventListener("click", () => $("invalidate-dialog").close());
$("inv-tickets").addEventListener("change", updateInvalidate);
$("inv-refund").addEventListener("input", () => { invDlg.refundEdited = true; });
$("inv-all").addEventListener("click", () => {
  document.querySelectorAll("#inv-tickets input[data-inv]:not(:disabled)").forEach((i) => { i.checked = true; });
  updateInvalidate();
});

$("refund-form").addEventListener("submit", submitRefund);
$("rf-cancel").addEventListener("click", () => $("refund-dialog").close());
$("rf-notowed").addEventListener("click", refundNotOwed);
$("rf-unknown").addEventListener("click", async () => { $("refund-dialog").close(); await markAlreadyReturned(rfDlg.order); });
$("find-payment-button").addEventListener("click", openFindDialog);
