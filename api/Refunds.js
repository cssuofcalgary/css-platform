/**
 * CSS Platform API — cancelling, invalidating tickets, and money owed back.
 *
 * The platform never moves money. It only keeps track of it, in three separate steps:
 *   1. Cancel an unpaid registration            (nothing was paid, so nothing is owed back)
 *   2. Invalidate paid tickets                  (the old QR codes stop working at once; any money owed back is written down)
 *   3. Record that the money was returned       (amount, method, date, who did it)
 * Money owed back lives in the Refunds table, one row per decision, so "Refund owed $160" stays on screen until Finance
 * records the return. Orders keep `received` (what actually arrived); `total` is what the still-valid tickets cost.
 */

const REFUND_METHODS = ["e-transfer", "cash", "other"];
const REFUND_MAX = 5000;

function cents_(n) { return Math.round((Number(n) || 0) * 100); }
function dollars_(c) { return Math.round(c) / 100; }
/** "$8" or "$8.50" (never "Free", which moneyText_ says for 0). */
function usd_(n) { n = Number(n) || 0; return "$" + (n % 1 ? n.toFixed(2) : String(n)); }
function clip_(v, n) { return String(v === undefined || v === null ? "" : v).trim().replace(/\s+/g, " ").slice(0, n); }
function todayEdmonton_() { return Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd"); }

/**
 * What an order has actually received. Orders paid before this was tracked have a blank `received`: a paid order is taken
 * to have received exactly its total (it was marked paid only when the e-transfer arrived), an unpaid one nothing.
 */
function receivedOf_(order) {
  if (order.received !== "" && order.received !== undefined && order.received !== null) return Number(order.received) || 0;
  return order.status === "paid" ? Number(order.total) || 0 : 0;
}

/** One refund row as the screen needs it: how much is owed, how much came back, how much is left. */
function refundView_(r) {
  const returns = Array.isArray(r.returns) ? r.returns : [];
  const back = returns.reduce(function (sum, x) { return sum + cents_(x.amount); }, 0);
  const owed = cents_(r.owed);
  return {
    id: r.id, kind: r.kind, status: r.status, reason: r.reason || "", createdAt: r.createdAt, createdBy: r.createdBy,
    owed: dollars_(owed), returned: dollars_(back), remaining: r.status === "owed" ? dollars_(Math.max(0, owed - back)) : 0,
    ticketIds: Array.isArray(r.ticketIds) ? r.ticketIds : [], returns: returns
  };
}

/**
 * Where an order stands on money owed back:
 *   owed       = Finance still has to return money                    (red)
 *   returned   = everything owed was returned and written down        (quiet)
 *   unrecorded = refunded before returns were tracked: unknown          (grey, nothing to chase)
 *   none       = nothing owed
 */
function refundState_(order, views) {
  if (views.some(function (v) { return v.status === "owed" && v.remaining > 0; })) return "owed";
  if (views.some(function (v) { return v.status === "returned"; })) return "returned";
  if (!views.length && order.status === "refunded") return "unrecorded";
  return "none";
}

// ---- Cancel / invalidate -------------------------------------------------------------------------

/**
 * Finance: stop some or all tickets of an order working. Unpaid tickets are cancelled; paid tickets are invalidated (their
 * QR codes are rejected at the door from this moment). `refundAmount` is the money to give back (defaults to what the
 * paid tickets cost; Finance may enter less, such as keeping a fee, or 0). Tickets already checked in can't be invalidated.
 */
function invalidateTickets_(session, req) {
  req = req || {};
  const ids = [];
  (Array.isArray(req.ticketIds) ? req.ticketIds : []).forEach(function (id) { id = String(id || ""); if (id && ids.indexOf(id) === -1) ids.push(id); });
  if (!ids.length) throw new ApiError_("BAD_REQUEST", "Pick at least one ticket.");
  const reason = clip_(req.reason, 200);
  let wanted = null;
  if (req.refundAmount !== undefined && req.refundAmount !== null && String(req.refundAmount).trim() !== "") {
    wanted = Number(req.refundAmount);
    if (!isFinite(wanted) || wanted < 0 || wanted > REFUND_MAX) throw new ApiError_("BAD_REQUEST", "The refund amount doesn't look right.");
  }

  return withLock_(function () {
    delete DB_.rows["Orders"]; delete DB_.rows["Tickets"];
    const order = readRows_("Orders").filter(function (o) { return o.id === req.orderId; })[0];
    if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
    if (order.status !== "paid" && order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This order is already " + order.status + ".");

    const live = readRows_("Tickets").filter(function (t) { return t.orderId === order.id && (t.status === "paid" || t.status === "awaiting"); });
    const chosen = ids.map(function (id) { return live.filter(function (t) { return t.id === id; })[0]; });
    if (chosen.some(function (t) { return !t; })) throw new ApiError_("BAD_REQUEST", "One of those tickets isn't part of this order, or it was already cancelled.");
    const inside = chosen.filter(function (t) { return t.checkedInAt; });
    if (inside.length) {
      throw new ApiError_("BAD_REQUEST", inside.map(function (t) { return t.name; }).join(", ") + (inside.length === 1 ? " has" : " have") +
        " already checked in. Undo the check-in at the Door tab first, or leave " + (inside.length === 1 ? "that ticket" : "those tickets") + " valid.");
    }

    const whole = chosen.length === live.length;
    const paidOnes = chosen.filter(function (t) { return t.status === "paid"; });
    const receivedBefore = receivedOf_(order);
    const priceOf = function (list) { return list.reduce(function (sum, t) { return sum + cents_(t.price); }, 0); };

    // What is owed back: the price of the paid tickets stopped; a whole unpaid order that had part-payments owes those back.
    let suggested = priceOf(paidOnes);
    if (order.status === "awaiting" && whole) suggested = cents_(receivedBefore);
    const owedCents = wanted !== null ? cents_(wanted) : suggested;
    if (owedCents > cents_(receivedBefore) + 1) {
      throw new ApiError_("BAD_REQUEST", "Only " + usd_(receivedBefore) + " was received for this order, so you can't give back " + usd_(dollars_(owedCents)) + ".");
    }

    const now = new Date().toISOString();
    const wasPaid = order.status === "paid";
    const orderChange = {
      notes: [order.notes, (whole ? (wasPaid ? "refunded" : "cancelled") : chosen.length + " ticket" + (chosen.length === 1 ? "" : "s") + " invalidated") + " by " + session.name + (reason ? ": " + reason : "")].filter(Boolean).join(" | ")
    };
    if (receivedBefore > 0 || wasPaid) orderChange.received = String(receivedBefore);   // freeze what really arrived
    if (whole) orderChange.status = wasPaid ? "refunded" : "cancelled";
    else orderChange.total = dollars_(live.filter(function (t) { return chosen.indexOf(t) === -1; }).reduce(function (sum, t) { return sum + cents_(t.price); }, 0));
    updateRow_("Orders", order.id, orderChange, order._row);
    chosen.forEach(function (t) { updateRow_("Tickets", t.id, { status: t.status === "paid" ? "refunded" : "cancelled" }, t._row); });

    let refund = null;
    if (owedCents > 0) {
      refund = {
        id: newId_("RF"), orderId: order.id, orderCode: order.code, eventId: order.eventId, payerName: order.payerName, payerEmail: order.payerEmail,
        kind: "tickets", ticketIds: chosen.map(function (t) { return t.id; }), owed: dollars_(owedCents), returns: [], status: "owed",
        reason: reason, createdAt: now, createdBy: session.name, closedAt: ""
      };
      insertRow_("Refunds", refund);
    }
    log_(session.name, wasPaid ? "order.refunded" : "order.cancelled", order.code, {
      total: order.total, tickets: chosen.length, whole: whole, owed: dollars_(owedCents), reason: reason
    });
    return {
      ok: true, invalidated: chosen.length, paidInvalidated: paidOnes.length, whole: whole,
      orderStatus: whole ? (wasPaid ? "refunded" : "cancelled") : order.status,
      qrRejected: paidOnes.length > 0, refund: refund ? { id: refund.id, owed: refund.owed } : null
    };
  });
}

/** The old whole-order button (and any page still on the old version): invalidate every ticket in the order. */
function refundOrder_(session, orderId, reason) {
  const live = readRows_("Tickets").filter(function (t) { return t.orderId === orderId && (t.status === "paid" || t.status === "awaiting"); });
  return invalidateTickets_(session, { orderId: orderId, ticketIds: live.map(function (t) { return t.id; }), reason: reason });
}

// ---- Record the money going back -----------------------------------------------------------------

/**
 * Finance: write down that money was returned. Either `refundId` (an open "refund owed") or `orderId` of an order refunded
 * before returns were tracked. `unknown: true` = "it was returned, but I don't know when or how" for those old ones.
 * The amount may be less than owed: the rest stays owed until it is recorded too.
 */
function recordRefund_(session, req) {
  req = req || {};
  const unknown = req.unknown === true;
  const method = unknown ? "unknown" : String(req.method || "");
  if (!unknown && REFUND_METHODS.indexOf(method) === -1) throw new ApiError_("BAD_REQUEST", "Choose how the money was returned: e-transfer, cash or other.");
  let date = clip_(req.date, 10);
  if (!unknown) {
    if (!date) date = todayEdmonton_();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate_(date)) throw new ApiError_("BAD_REQUEST", "The date the money was returned doesn't look right.");
    if (date > todayEdmonton_()) throw new ApiError_("BAD_REQUEST", "The date can't be in the future.");
  } else date = "";
  const by = clip_(req.by, 60) || session.name;
  const note = clip_(req.note, 200);

  return withLock_(function () {
    delete DB_.rows["Orders"]; delete DB_.rows["Refunds"];
    let rec = req.refundId ? readRows_("Refunds").filter(function (r) { return r.id === req.refundId; })[0] : null;
    let order;
    if (!rec) {
      order = readRows_("Orders").filter(function (o) { return o.id === req.orderId; })[0];
      if (!order) throw new ApiError_("NOT_FOUND", "Nothing to record a refund against.");
      if (order.status !== "refunded" || readRows_("Refunds").some(function (r) { return r.orderId === order.id; })) {
        throw new ApiError_("BAD_REQUEST", "This order has no refund waiting to be recorded.");
      }
      const was = receivedOf_(order) || Number(order.total) || 0;
      rec = {
        id: newId_("RF"), orderId: order.id, orderCode: order.code, eventId: order.eventId, payerName: order.payerName, payerEmail: order.payerEmail,
        kind: "history", ticketIds: [], owed: was, returns: [], status: "owed", reason: "Refunded before returns were tracked",
        createdAt: new Date().toISOString(), createdBy: session.name, closedAt: ""
      };
      insertRow_("Refunds", rec);
      rec = readRows_("Refunds").filter(function (r) { return r.id === rec.id; })[0] || rec;
    }
    if (rec.status !== "owed") throw new ApiError_("BAD_REQUEST", "This refund is already " + rec.status + ".");

    const view = refundView_(rec);
    const amount = unknown || req.amount === undefined || req.amount === "" ? view.remaining : Number(req.amount);
    if (!isFinite(amount) || amount <= 0) throw new ApiError_("BAD_REQUEST", "Enter the amount that was returned.");
    if (cents_(amount) > cents_(view.remaining) + 1) throw new ApiError_("BAD_REQUEST", "Only " + usd_(view.remaining) + " is still owed on this refund.");

    const returns = view.returns.concat([{ amount: dollars_(cents_(amount)), method: method, date: date, by: by, note: note, recordedBy: session.name, recordedAt: new Date().toISOString() }]);
    const left = cents_(view.remaining) - cents_(amount);
    const changes = { returns: returns, status: left <= 0 ? "returned" : "owed", closedAt: left <= 0 ? new Date().toISOString() : "" };
    updateRow_("Refunds", rec.id, changes, rec._row);
    log_(session.name, "refund.returned", rec.orderCode, { amount: dollars_(cents_(amount)), method: method, remaining: dollars_(left), by: by });
    return { ok: true, refund: refundView_(Object.assign({}, rec, changes)), remaining: dollars_(left) };
  });
}

/** Finance: this refund was a mistake or is no longer owed. It stays on record as cancelled, with the reason. */
function cancelRefund_(session, refundId, reason) {
  const why = clip_(reason, 200);
  if (why.length < 3) throw new ApiError_("BAD_REQUEST", "Say why nothing is owed after all, in a few words.");
  return withLock_(function () {
    delete DB_.rows["Refunds"];
    const rec = readRows_("Refunds").filter(function (r) { return r.id === refundId; })[0];
    if (!rec) throw new ApiError_("NOT_FOUND", "Refund not found.");
    if (rec.status !== "owed") throw new ApiError_("BAD_REQUEST", "This refund is already " + rec.status + ".");
    updateRow_("Refunds", rec.id, { status: "waived", reason: [rec.reason, "cancelled by " + session.name + ": " + why].filter(Boolean).join(" | "), closedAt: new Date().toISOString() }, rec._row);
    log_(session.name, "refund.cancelled", rec.orderCode, { owed: rec.owed, reason: why });
    return { ok: true };
  });
}

/** Refund rows for one event, grouped by order (for the Payments list). */
function refundsByOrder_(eventId) {
  const map = {};
  readRows_("Refunds").forEach(function (r) {
    if (r.eventId !== eventId) return;
    (map[r.orderId] = map[r.orderId] || []).push(refundView_(r));
  });
  return map;
}

// ---- Putting tickets back (undo a mistake) ------------------------------------------------------

/**
 * Finance: "I stopped the wrong ticket." Put some invalidated or cancelled tickets of a LIVE order back, as long as no money has
 * been returned for them yet. The refund owed for them is reduced (or cancelled). Same room rules as a new registration.
 */
function restoreTickets_(session, req) {
  const ids = [];
  ((req && req.ticketIds) || []).forEach(function (id) { id = String(id || ""); if (id && ids.indexOf(id) === -1) ids.push(id); });
  if (!ids.length) throw new ApiError_("BAD_REQUEST", "Pick at least one ticket.");
  return withLock_(function () {
    delete DB_.rows["Orders"]; delete DB_.rows["Tickets"]; delete DB_.rows["Refunds"]; delete DB_.rows["Events"];
    const order = readRows_("Orders").filter(function (o) { return o.id === req.orderId; })[0];
    if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
    if (order.status !== "paid" && order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "Use Restore order for a fully cancelled or refunded order.");
    const mine = readRows_("Tickets").filter(function (t) { return t.orderId === order.id; });
    const chosen = ids.map(function (id) { return mine.filter(function (t) { return t.id === id; })[0]; });
    if (chosen.some(function (t) { return !t || (t.status !== "refunded" && t.status !== "cancelled"); })) throw new ApiError_("BAD_REQUEST", "Only cancelled or invalidated tickets can be put back.");
    const refunds = readRows_("Refunds").filter(function (r) { return r.orderId === order.id && r.status !== "waived"; });
    chosen.forEach(function (t) {
      const rec = refunds.filter(function (r) { return Array.isArray(r.ticketIds) && r.ticketIds.indexOf(t.id) !== -1; })[0];
      if (rec && (refundView_(rec).returned > 0 || rec.status === "returned")) {
        throw new ApiError_("BAD_REQUEST", t.name + "'s refund was already returned, so the ticket can't be put back. Register them again instead.");
      }
    });
    const event = findEvent_(function (e) { return e.id === order.eventId; });
    if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
    assertNotArchived_(event);
    if (event.capacity && !req.force) {
      const taken = readRows_("Tickets").filter(function (t) { return t.eventId === event.id && (t.status === "paid" || t.status === "awaiting"); }).length;
      const limit = event.capacityRule === "all" ? event.capacity : Math.floor(event.capacity * 1.25);
      if (taken + chosen.length > limit) throw new ApiError_("OVER_CAPACITY", "Putting these back would make " + (taken + chosen.length) + " paid and waiting tickets, over the limit of " + limit + ".");
    }

    chosen.forEach(function (t) { updateRow_("Tickets", t.id, { status: t.status === "refunded" ? "paid" : "awaiting" }, t._row); });
    const orderTotal = readRows_("Tickets").filter(function (t) { return t.orderId === order.id && (t.status === "paid" || t.status === "awaiting"); })
      .reduce(function (sum, t) { return sum + cents_(t.price); }, 0);
    updateRow_("Orders", order.id, {
      total: dollars_(orderTotal),
      notes: [order.notes, chosen.length + " ticket" + (chosen.length === 1 ? "" : "s") + " put back by " + session.name].filter(Boolean).join(" | ")
    }, order._row);

    // The refund that was owed for these tickets shrinks (or is cancelled when nothing is left in it).
    refunds.forEach(function (rec) {
      const covered = (rec.ticketIds || []).filter(function (id) { return ids.indexOf(id) !== -1; });
      if (!covered.length) return;
      const left = (rec.ticketIds || []).filter(function (id) { return ids.indexOf(id) === -1; });
      const priceBack = chosen.filter(function (t) { return covered.indexOf(t.id) !== -1; }).reduce(function (sum, t) { return sum + cents_(t.price); }, 0);
      const owed = Math.max(0, cents_(rec.owed) - priceBack);
      const changes = left.length && owed > 0 ? { ticketIds: left, owed: dollars_(owed) }
        : { ticketIds: left, owed: dollars_(owed), status: "waived", closedAt: new Date().toISOString(), reason: [rec.reason, "tickets put back by " + session.name].filter(Boolean).join(" | ") };
      updateRow_("Refunds", rec.id, changes, rec._row);
    });
    log_(session.name, "tickets.restored", order.code, { tickets: chosen.length });
    return { ok: true, restored: chosen.length, orderStatus: order.status };
  });
}
