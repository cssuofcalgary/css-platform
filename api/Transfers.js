/**
 * CSS Platform API — recording an e-transfer against orders.
 *
 * One Interac e-transfer is rarely perfect. Finance enters what ARRIVED (amount and the name on the transfer) and picks the
 * order or orders it belongs to; this file compares the two and carries out the choice Finance made:
 *   exact                  -> the orders are marked paid and ticket emails go out
 *   too little             -> keep waiting for the rest (orders stay unpaid, "$X still to come"), or accept it as paid in full
 *   too much               -> refund the extra (written down as money owed back), or keep it (written in the notes)
 *   order was cancelled    -> put it back and confirm it, or refund the whole payment
 *   event is full          -> confirm over the limit, or refund the payment and cancel the registration
 * `findTransfer_` suggests the orders for a payment that has no or the wrong code, or came under someone else's name.
 */

const MAX_TRANSFER_ORDERS = 10;
const MAX_TRANSFER_AMOUNT = 5000;

function applyTransfer_(session, req) {
  req = req || {};
  rememberSiteUrl_(req.siteUrl);
  const amountC = cents_(req.amount);
  if (!(amountC > 0) || amountC > MAX_TRANSFER_AMOUNT * 100) throw new ApiError_("BAD_REQUEST", "Enter the amount that arrived, like 25 or 25.50.");
  const ids = [];
  (Array.isArray(req.orderIds) ? req.orderIds : []).forEach(function (id) { id = String(id || ""); if (id && ids.indexOf(id) === -1) ids.push(id); });
  if (!ids.length) throw new ApiError_("BAD_REQUEST", "Pick the order this payment is for.");
  if (ids.length > MAX_TRANSFER_ORDERS) throw new ApiError_("BAD_REQUEST", "Up to " + MAX_TRANSFER_ORDERS + " orders per payment.");
  const sender = clip_(req.senderName, 80);
  const over = req.over === "refund" || req.over === "keep" ? req.over : "";
  const short = req.short === "wait" || req.short === "accept" ? req.short : "";
  const late = req.late === "restore" || req.late === "refund" ? req.late : "";
  const full = req.full === "confirm" || req.full === "refund" ? req.full : "";
  const force = full === "confirm";
  const rid = cleanRequestId_(req.requestId);
  const op = "applyTransfer:" + (rid || newId_("OP"));   // marks the orders this press changes (see applyWrites_)

  const outcome = withIntakeAndScriptLock_(function () {
    // The same press again (the answer got lost, or it stopped halfway): never add the money a second time.
    const saved = savedRequest_("applyTransfer", rid);
    if (saved && saved.status === "done") return { repeat: saved.reply };
    if (saved && saved.status === "started") return carryOutTransfer_(session, saved.plan);
    delete DB_.rows["Orders"]; delete DB_.rows["Tickets"]; delete DB_.rows["Refunds"]; delete DB_.rows["Events"];
    let orders = ids.map(function (id) { return readRows_("Orders").filter(function (o) { return o.id === id; })[0]; });
    if (orders.some(function (o) { return !o; })) throw new ApiError_("NOT_FOUND", "One of those orders no longer exists.");
    const paidAlready = orders.filter(function (o) { return o.status === "paid"; });
    if (paidAlready.length) throw new ApiError_("BAD_REQUEST", paidAlready.map(function (o) { return o.code; }).join(", ") + " is already paid. If this is an extra payment, write it in the order's notes instead.");
    const events = {};
    orders.forEach(function (o) {
      const ev = findEvent_(function (e) { return e.id === o.eventId; });
      if (!ev) throw new ApiError_("NOT_FOUND", "Event not found.");
      assertNotArchived_(ev);
      events[o.eventId] = ev;
    });
    const closed = orders.filter(function (o) { return o.status !== "awaiting"; });
    const now = new Date().toISOString();
    const nameNote = sender ? " from " + sender : "";
    const money1 = usd_(dollars_(amountC));

    // ---- The whole payment goes back: an order that was cancelled, or an event that is full
    const allClosed = closed.length === orders.length;
    // Every write is planned first and written down (startRequest_), then carried out (carryOutTransfer_), so a press that
    // stops halfway can be finished by pressing again without counting anything twice.
    if ((late === "refund" && allClosed) || full === "refund") {
      const first = orders[0];
      const writes = [];
      orders.forEach(function (o, i) {
        const change = { notes: [o.notes, "payment of " + money1 + nameNote + " received, to be returned (recorded by " + session.name + ")"].filter(Boolean).join(" | ") };
        if (i === 0) change.received = String(dollars_(cents_(receivedOf_(o)) + amountC));
        if (o.status === "awaiting") {   // the event is full: this registration can't be confirmed
          change.status = "cancelled";
          readRows_("Tickets").forEach(function (t) { if (t.orderId === o.id && (t.status === "awaiting" || t.status === "disabled")) writes.push({ table: "Tickets", id: t.id, set: { status: "cancelled", disabledFrom: "" }, was: { status: t.status } }); });
        }
        writes.push({ table: "Orders", id: o.id, set: change, was: { received: o.received == null ? "" : o.received, status: o.status } });
      });
      const rec = {
        id: newId_("RF"), orderId: first.id, orderCode: first.code, eventId: first.eventId, payerName: first.payerName, payerEmail: first.payerEmail,
        kind: allClosed ? "late payment" : "event full", ticketIds: [], owed: dollars_(amountC), returns: [], status: "owed",
        reason: allClosed ? "Payment arrived after the registration was cancelled" : "Payment arrived but the event is full", createdAt: now, createdBy: session.name, closedAt: ""
      };
      writes.push({ table: "Refunds", add: rec });
      const plan = { op: op, writes: writes, paidIds: [], force: false, log: ["payment.refund", first.code, { amount: dollars_(amountC), why: rec.kind }],
        outcome: { mode: "refund", refund: { id: rec.id, owed: rec.owed } } };
      startRequest_("applyTransfer", rid, session.name, plan);
      return carryOutTransfer_(session, plan);
    }

    // Plan closed-order restores without writing anything: amount choices, capacity and duplicates can still reject this press.
    const restores = {};
    const restoreWrites = [];
    if (closed.length) {
      if (late !== "restore") throw new ApiError_("BAD_REQUEST", closed.map(function (o) { return o.code; }).join(", ") + " was cancelled. Choose to put it back and confirm it, or to refund this payment.");
      closed.forEach(function (o) {
        const plan = planRestoreOrder_(session, o, force);
        restores[o.id] = plan;
        Array.prototype.push.apply(restoreWrites, plan.writes);
      });
      Object.keys(events).forEach(function (eid) {
        const returning = closed.filter(function (o) { return o.eventId === eid; }).reduce(function (list, o) { return list.concat(restores[o.id].returning); }, []);
        if (returning.length) assertRestoredTickets_(events[eid], returning, force);
      });
      orders = orders.map(function (o) { return restores[o.id] ? Object.assign({}, o, restores[o.id].change) : o; });
    }

    // ---- Is there room to confirm all of these? Checked up front: nothing about payment is written until it passes.
    if (!force) {
      Object.keys(events).forEach(function (eid) {
        const ev = events[eid];
        if (!ev.capacity || ev.capacityRule !== "paid") return;
        const coming = orders.filter(function (o) { return o.eventId === eid; }).reduce(function (sum, o) {
          return sum + (restores[o.id] ? restores[o.id].returning.length : readRows_("Tickets").filter(function (t) { return t.orderId === o.id && t.status === "awaiting"; }).length);
        }, 0);
        const taken = spotsTaken_(ev);
        if (taken + coming > ev.capacity) throw new ApiError_("OVER_CAPACITY", "This would make " + (taken + coming) + " paid tickets for " + ev.name + ", over its capacity of " + ev.capacity + ".");
      });
    }

    // ---- Compare what arrived with what is due
    const due = orders.map(function (o) {
      let committed = refundCommittedCents_(o.id);
      if (restores[o.id]) restores[o.id].writes.forEach(function (w) {
        if (w.table !== "Refunds" || w.set.status !== "waived") return;
        const rec = readRows_("Refunds").filter(function (r) { return r.id === w.id; })[0];
        committed -= cents_(refundView_(rec).remaining);
      });
      return Math.max(0, cents_(o.total) - Math.max(0, cents_(receivedOf_(o)) - committed));
    });
    const sumDue = due.reduce(function (a, b) { return a + b; }, 0);
    const diff = amountC - sumDue;
    if (diff > 0 && !over) throw new ApiError_("BAD_REQUEST", "That is " + usd_(dollars_(diff)) + " more than " + (orders.length === 1 ? "the order" : "these orders") + " need. Choose to refund the extra or keep it.");
    if (diff < 0 && !short) throw new ApiError_("BAD_REQUEST", "That is " + usd_(dollars_(-diff)) + " short. Choose to keep waiting for the rest, or accept it as paid in full.");

    let rem = amountC;
    const alloc = due.map(function (d) { const take = Math.min(d, rem); rem -= take; return take; });
    const others = function (o) { return orders.filter(function (x) { return x !== o; }).map(function (x) { return x.code; }); };
    const paidOrders = [];
    const results = [];
    const writes = restoreWrites.slice();
    orders.forEach(function (o, i) {
      const covered = alloc[i] >= due[i];
      const markPaid = covered || (diff < 0 && short === "accept");
      const extra = i === 0 && diff > 0 ? rem : 0;
      const change = Object.assign({}, restores[o.id] ? restores[o.id].change : {}, {
        received: String(dollars_(cents_(receivedOf_(o)) + alloc[i] + extra)),
        notes: [o.notes, "payment " + usd_(dollars_(alloc[i] + extra)) + nameNote + (others(o).length ? ", together with " + others(o).join(", ") : "") +
          (diff < 0 && short === "accept" && !covered ? ", accepted as paid in full (" + usd_(dollars_(due[i] - alloc[i])) + " short)" : "") +
          (extra && over === "keep" ? ", extra " + usd_(dollars_(extra)) + " kept" : "") + " (recorded by " + session.name + ")"].filter(Boolean).join(" | ")
      });
      if (sender && o.etransferName !== sender) change.etransferName = sender;
      const original = readRows_("Orders").filter(function (row) { return row.id === o.id; })[0];
      writes.push({ table: "Orders", id: o.id, set: change, was: { received: original.received == null ? "" : original.received, status: original.status, total: original.total } });
      results.push({ orderId: o.id, code: o.code, paid: markPaid, stillDue: markPaid ? 0 : dollars_(due[i] - alloc[i]) });
      if (markPaid) paidOrders.push(o);
    });

    let refund = null;
    if (diff > 0 && over === "refund") {
      const first = orders[0];
      const rec = {
        id: newId_("RF"), orderId: first.id, orderCode: first.code, eventId: first.eventId, payerName: first.payerName, payerEmail: first.payerEmail,
        kind: "overpayment", ticketIds: [], owed: dollars_(diff), returns: [], status: "owed", reason: "Paid " + money1 + ", the order was " + usd_(dollars_(sumDue)),
        createdAt: now, createdBy: session.name, closedAt: ""
      };
      writes.push({ table: "Refunds", add: rec });
      refund = { id: rec.id, owed: rec.owed };
    }
    const plan = {
      op: op, writes: writes, paidIds: paidOrders.map(function (o) { return o.id; }), force: force,
      restoredTicketIds: restoreWrites.filter(function (w) { return w.table === "Tickets"; }).map(function (w) { return w.id; }),
      log: ["order.payment", orders.map(function (o) { return o.code; }).join(","), {
        amount: dollars_(amountC), due: dollars_(sumDue), sender: sender, short: diff < 0 ? short : "", over: diff > 0 ? over : "", paid: paidOrders.length
      }],
      outcome: { mode: "pay", results: results, refund: refund, shortBy: diff < 0 ? dollars_(-diff) : 0, extra: diff > 0 ? dollars_(diff) : 0 }
    };
    startRequest_("applyTransfer", rid, session.name, plan);
    return carryOutTransfer_(session, plan);
  });
  if (outcome.repeat) return outcome.repeat;
  if (outcome.review) {   // kept, so pressing the same button again gives the same "check it" answer instead of guessing
    finishRequest_("applyTransfer", rid, session.name, outcome.review);
    return outcome.review;
  }

  // Emails go out after the lock is released, like every other payment.
  let sent = 0, waiting = 0, notEmailed = 0;
  outcome.paidIds.forEach(function (id) {
    const r = emailsAfterSave_(id);
    sent += r.sent; waiting += r.waiting; notEmailed += r.notEmailed || 0;
  });
  const reply = {
    ok: true, mode: outcome.mode, confirmed: outcome.confirmed, results: outcome.results || [], refund: outcome.refund,
    shortBy: outcome.shortBy || 0, extra: outcome.extra || 0,
    emailsSent: sent, emailsWaiting: waiting, notEmailed: notEmailed, emailsLeftToday: emailsLeftToday_()
  };
  finishRequest_("applyTransfer", rid, session.name, reply);
  return reply;
}

/**
 * Carries out a planned payment (call it while holding the lock). Safe to run again for the same plan: money already added is
 * not added again, a refund already written is not written again, and an order already paid stays paid.
 * If an order changed since the plan was made (and not by this press), nothing more is written and `review` holds the "check it" reply.
 */
function carryOutTransfer_(session, plan) {
  if (plan.restoredTicketIds && plan.restoredTicketIds.length) {
    const all = readRows_("Tickets");
    const events = {};
    plan.restoredTicketIds.forEach(function (id) {
      const ticket = all.filter(function (t) { return t.id === id; })[0];
      if (!ticket) throw new ApiError_("NOT_FOUND", "A ticket being restored no longer exists.");
      (events[ticket.eventId] = events[ticket.eventId] || []).push(Object.assign({}, ticket, { status: plan.paidIds.indexOf(ticket.orderId) !== -1 ? "paid" : "awaiting" }));
    });
    Object.keys(events).forEach(function (eventId) {
      const event = findEvent_(function (e) { return e.id === eventId; });
      if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
      assertNotArchived_(event);
      assertRestoredTickets_(event, events[eventId], plan.force);
    });
  }
  const result = applyWrites_(plan.writes, plan.op);
  if (result.conflicts.length) {   // someone changed an order since: record nothing more, no refund, no "paid"; Finance checks
    log_(session.name, "payment.needsReview", plan.log[1], { conflicts: result.conflicts, planned: plan.log[2] });
    return { review: needsReviewReply_(result.conflicts, result.done) };
  }
  let confirmed = 0;
  plan.paidIds.forEach(function (id) { confirmed += markPaidLocked_(session, id, plan.force, true).confirmed || 0; });
  log_(session.name, plan.log[0], plan.log[1], plan.log[2]);
  return Object.assign({}, plan.outcome, { paidIds: plan.paidIds, confirmed: confirmed });
}

// ---- Finding the order for a payment ----------------------------------------------------------

function nameTokens_(text) {
  return normalizeName_(text).split(" ").filter(function (w) { return w.length >= 2; });
}

/**
 * Read-only: orders that could be the one a payment belongs to. {amount, name, code}. Looks at unpaid orders (and cancelled
 * ones) for events that have not happened yet. Scores: matching code, same amount, matching name; also suggests two or three
 * unpaid orders by the same person whose totals add up to the amount (one transfer for several registrations).
 */
function findTransfer_(req) {
  req = req || {};
  const amountC = cents_(req.amount);
  const code = String(req.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nameTok = nameTokens_(req.name || "");
  if (!amountC && !code && !nameTok.length) throw new ApiError_("BAD_REQUEST", "Enter the amount, the name on the transfer, or the code.");

  const today = todayEdmonton_();
  const events = {};
  allEvents_().forEach(function (e) { if (!e.archivedAt && e.date >= today) events[e.id] = e; });
  const names = {};
  readRows_("Tickets").forEach(function (t) { (names[t.orderId] = names[t.orderId] || []).push(t.name); });

  const pool = readRows_("Orders").filter(function (o) { return events[o.eventId] && (o.status === "awaiting" || (o.status === "cancelled" && !isFailedOrder_(o))); });
  const scored = pool.map(function (o) {
    const reasons = [];
    let score = 0;
    const dueC = Math.max(0, cents_(o.total) - availableReceivedCents_(o));
    if (code && String(o.code).toUpperCase().replace(/[^A-Z0-9]/g, "") === code) { score += 100; reasons.push("Code matches"); }
    if (amountC && (amountC === dueC || amountC === cents_(o.total))) { score += 40; reasons.push("Amount matches"); }
    if (nameTok.length) {
      const hay = nameTokens_([o.payerName, o.etransferName].concat(names[o.id] || []).join(" "));
      const hits = nameTok.filter(function (w) { return hay.indexOf(w) !== -1; }).length;
      if (hits >= 2 || (hits === 1 && nameTok.length === 1)) { score += 50; reasons.push("Name matches"); }
      else if (hits === 1) { score += 25; reasons.push("Part of the name matches"); }
    }
    if (o.status === "cancelled") reasons.push("Cancelled order");
    return { o: o, score: score, reasons: reasons, dueC: dueC };
  }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score || String(b.o.createdAt).localeCompare(String(a.o.createdAt)); }).slice(0, 8);

  const groups = [];
  if (amountC) {
    const byPayer = {};
    pool.filter(function (o) { return o.status === "awaiting"; }).forEach(function (o) {
      const key = String(o.payerEmail || "").toLowerCase() || normalizeName_(o.payerName);
      if (key) (byPayer[key] = byPayer[key] || []).push(o);
    });
    Object.keys(byPayer).forEach(function (key) {
      const list = byPayer[key].slice(0, 12);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const sum2 = cents_(list[i].total) + cents_(list[j].total);
          if (sum2 === amountC) groups.push([list[i], list[j]]);
          for (let k = j + 1; k < list.length; k++) if (sum2 + cents_(list[k].total) === amountC) groups.push([list[i], list[j], list[k]]);
        }
      }
    });
  }

  const view = function (x) {
    const o = x.o, ev = events[o.eventId];
    return {
      id: o.id, code: o.code, status: o.status, payerName: o.payerName, etransferName: o.etransferName || "", total: Number(o.total) || 0,
      stillDue: dollars_(x.dueC), eventName: ev.name, eventId: ev.id, reasons: x.reasons, tickets: (names[o.id] || []).slice(0, 6)
    };
  };
  return {
    ok: true,
    candidates: scored.map(view),
    groups: groups.slice(0, 4).map(function (g) {
      return { orderIds: g.map(function (o) { return o.id; }), codes: g.map(function (o) { return o.code; }), total: dollars_(amountC), payerName: g[0].payerName, eventName: (events[g[0].eventId] || {}).name || "" };
    })
  };
}
