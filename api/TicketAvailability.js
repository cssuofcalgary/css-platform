/** A disabled ticket remains on its registration and keeps its payment, but does not hold a place. */
function retainedTicket_(ticket) {
  return ticket.status === "paid" || ticket.status === "awaiting" || ticket.status === "disabled";
}

/** The payment state beneath a disabled ticket. Recording a payment never enables a ticket. */
function ticketPaymentStatus_(ticket, order) {
  if (ticket.status !== "disabled") return ticket.status;
  if (order && order.status === "paid") return "paid";
  return ticket.disabledFrom === "paid" ? "paid" : "awaiting";
}

/** Any exec can deliberately disable or enable selected people. There are no emails or refund changes. */
function setTicketEnabled_(session, req) {
  req = req || {};
  if (req.enabled !== true && req.enabled !== false) throw new ApiError_("BAD_REQUEST", "Choose whether to enable or disable these tickets.");
  const ids = [];
  (Array.isArray(req.ticketIds) ? req.ticketIds : []).forEach(function (id) {
    id = String(id || "");
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  if (!ids.length) throw new ApiError_("BAD_REQUEST", "Pick at least one ticket.");
  const rid = cleanRequestId_(req.requestId);
  return withIntakeAndScriptLock_(function () {
    const saved = savedRequest_("setTicketEnabled", rid);
    if (saved && saved.status === "done") return saved.reply;
    delete DB_.rows["Orders"]; delete DB_.rows["Tickets"]; delete DB_.rows["Events"];
    if (saved && saved.status === "started") return carryOutTicketAvailability_(session, rid, saved.plan, !!req.force);
    const order = readRows_("Orders").filter(function (o) { return o.id === req.orderId; })[0];
    if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
    if (order.status !== "paid" && order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This registration was cancelled. Restore it before enabling tickets.");
    const tickets = readRows_("Tickets");
    const chosen = ids.map(function (id) { return tickets.filter(function (t) { return t.id === id && t.orderId === order.id; })[0]; });
    if (chosen.some(function (t) { return !t || !retainedTicket_(t); })) throw new ApiError_("BAD_REQUEST", "One of these tickets is cancelled or does not belong to this registration.");
    const inside = chosen.filter(function (t) { return t.checkedInAt; });
    if (inside.length) throw new ApiError_("BAD_REQUEST", "Undo the check-in for " + inside.map(function (t) { return t.name; }).join(", ") + " before changing their ticket.");
    const changing = chosen.filter(function (t) { return req.enabled ? t.status === "disabled" : t.status !== "disabled"; });
    const writes = changing.map(function (t) {
      return { table: "Tickets", id: t.id,
        set: req.enabled ? { status: ticketPaymentStatus_(t, order), disabledFrom: "" } : { status: "disabled", disabledFrom: t.status },
        was: { status: t.status, disabledFrom: t.disabledFrom || "" } };
    });
    const plan = { orderId: order.id, eventId: order.eventId, enabled: req.enabled, writes: writes,
      reply: { ok: true, enabled: req.enabled, changed: changing.length > 0, count: changing.length, orderStatus: order.status } };
    startRequest_("setTicketEnabled", rid, session.name, plan);
    return carryOutTicketAvailability_(session, rid, plan, !!req.force);
  });
}

/** Repeated or interrupted presses use their saved plan. Capacity is checked again before any remaining enable. */
function carryOutTicketAvailability_(session, rid, plan, force) {
  const order = readRows_("Orders").filter(function (o) { return o.id === plan.orderId; })[0];
  if (!order || (order.status !== "paid" && order.status !== "awaiting")) throw new ApiError_("BAD_REQUEST", "This registration was cancelled. Restore it before changing tickets.");
  const event = findEvent_(function (e) { return e.id === plan.eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  assertNotArchived_(event);
  const currentTickets = readRows_("Tickets");
  const changingIds = plan.writes.map(function (w) { return w.id; });
  const inside = currentTickets.filter(function (t) { return changingIds.indexOf(t.id) !== -1 && t.checkedInAt; });
  if (!plan.enabled && inside.length) throw new ApiError_("BAD_REQUEST", "Undo the check-in for " + inside.map(function (t) { return t.name; }).join(", ") + " before disabling their ticket.");
  if (plan.enabled && order.status === "paid" && plan.writes.some(function (w) { return w.set.status !== "paid"; })) {
    // Finance may have confirmed payment since an interrupted enable. Keep it paid when finishing that same press.
    plan.writes.forEach(function (w) { w.set.status = "paid"; });
    plan.reply.orderStatus = "paid";
    if (rid) {
      const saved = savedRequest_("setTicketEnabled", rid);
      if (saved) updateRow_("Requests", saved.id, { plan: plan }, saved._row);
    }
  }
  if (plan.enabled && plan.writes.length) {
    const all = currentTickets;
    const ids = plan.writes.map(function (w) { return w.id; });
    const returning = plan.writes.map(function (w) {
      const t = all.filter(function (t) { return t.id === w.id; })[0];
      return Object.assign({}, t, { status: w.set.status });
    });
    const others = all.filter(function (t) { return ids.indexOf(t.id) === -1; });
    assertNoDuplicateRegistration_(returning, event.id, others);
    if (event.capacity && !force) {
      const paid = others.filter(function (t) { return t.eventId === event.id && t.status === "paid"; }).length;
      const awaiting = others.filter(function (t) { return t.eventId === event.id && t.status === "awaiting"; }).length;
      const addedPaid = returning.filter(function (t) { return t.status === "paid"; }).length;
      const total = paid + awaiting + returning.length;
      const limit = event.capacityRule === "all" ? event.capacity : Math.floor(event.capacity * 1.25);
      if (total > limit || (event.capacityRule !== "all" && (paid + addedPaid > event.capacity || (paid >= event.capacity && returning.some(function (t) { return t.status === "awaiting"; }))))) {
        throw new ApiError_("OVER_CAPACITY", "There isn't enough room to enable these tickets. Check the event capacity first.");
      }
    }
  }
  const result = applyWrites_(plan.writes, "");
  const reply = result.conflicts.length ? {
    ok: false, error: "NEEDS_REVIEW", conflicts: result.conflicts, alreadySaved: result.done,
    message: "These tickets changed since the first attempt. Refresh the registration and check their current status before trying again."
  } : plan.reply;
  if (!result.conflicts.length && plan.writes.length) log_(session.name, plan.enabled ? "tickets.enabled" : "tickets.disabled", order.code, { tickets: plan.writes.length });
  finishRequest_("setTicketEnabled", rid, session.name, reply);
  return reply;
}

/** Payment records stay in step underneath disabled tickets, without admitting or emailing anyone. */
function syncDisabledPayment_(order) {
  if (order.status !== "paid") return;
  readRows_("Tickets").filter(function (t) { return t.orderId === order.id && t.status === "disabled" && t.disabledFrom !== "paid"; })
    .forEach(function (t) { updateRow_("Tickets", t.id, { disabledFrom: "paid" }, t._row); });
}
