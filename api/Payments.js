/**
 * CSS Platform API — payments (Finance) and tickets.
 *
 * Finance checks the CSS Gmail for the e-transfer, finds the order by its payment
 * code or name, and marks it paid. Every ticket in the order becomes "paid" and
 * each person is emailed their own ticket (a link to their ticket page + QR code).
 */

/** Waiting too long for payment? (the same rule the reminder email uses; text like "test address, not sent" counts as handled) */
function reminderDue_(o) {
  if (o.status !== "awaiting") return false;
  const cutoff = Date.now() - REMINDER_AFTER_HOURS * 3600 * 1000;
  if (new Date(o.createdAt).getTime() > cutoff) return false;
  if (!o.remindedAt) return true;
  const when = new Date(o.remindedAt).getTime();
  return !isNaN(when) && when <= cutoff;
}

const ORDERS_PAGE = 50;       // orders sent per page
const ORDERS_PAGE_MAX = 200;

/**
 * Orders for one event, newest first, ONE PAGE at a time so the screen opens fast however many there are.
 * opts: { filter: awaiting | overdue | paid | closed | all (default awaiting), q (search text), offset, limit }.
 * Always returns the totals for the whole event (counts, money, spots) so the tiles and filter chips are right
 * without loading every order.
 */
function listOrders_(eventId, opts) {
  opts = opts || {};
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const tickets = eventRows_("Tickets", event);
  const byOrder = {};
  tickets.forEach(function (t) { (byOrder[t.orderId] = byOrder[t.orderId] || []).push(t); });
  const all = eventRows_("Orders", event);

  const counts = { all: all.length, awaiting: 0, overdue: 0, paid: 0, closed: 0, cancelRequests: 0 };
  const money = { received: 0, awaiting: 0 };
  all.forEach(function (o) {
    const total = Number(o.total) || 0;
    if (o.status === "awaiting") { counts.awaiting++; money.awaiting += total; if (reminderDue_(o)) counts.overdue++; if (o.cancelRequestedAt) counts.cancelRequests++; }
    else if (o.status === "paid") { counts.paid++; money.received += total; }
    else counts.closed++;
  });

  const filter = ["awaiting", "overdue", "cancelreq", "paid", "closed", "all"].indexOf(opts.filter) !== -1 ? opts.filter : "awaiting";
  const q = String(opts.q || "").trim().toLowerCase();
  const shown = all.filter(function (o) {
    if (filter === "awaiting" && o.status !== "awaiting") return false;
    if (filter === "overdue" && !reminderDue_(o)) return false;
    if (filter === "cancelreq" && !(o.status === "awaiting" && o.cancelRequestedAt)) return false;
    if (filter === "paid" && o.status !== "paid") return false;
    if (filter === "closed" && o.status !== "refunded" && o.status !== "cancelled") return false;
    if (!q) return true;
    // "$25" / "$25.00" = orders totalling that amount. A bare "25" matches that amount OR the text. Parents often e-transfer under another name with no memo.
    const amountOnly = q.charAt(0) === "$";
    const target = parseFloat(amountOnly ? q.slice(1).replace(/,/g, "") : q);
    const numeric = amountOnly ? !isNaN(target) : /^\d+(\.\d+)?$/.test(q);
    const sameAmount = numeric && Math.abs((Number(o.total) || 0) - target) < 0.01;
    if (amountOnly && numeric) return sameAmount;
    return sameAmount || [o.code, o.payerName, o.payerEmail, o.etransferName].concat((byOrder[o.id] || []).map(function (t) { return t.name; }))
      .some(function (v) { return String(v || "").toLowerCase().indexOf(q) !== -1; });
  }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  const limit = Math.min(ORDERS_PAGE_MAX, Math.max(1, parseInt(opts.limit, 10) || ORDERS_PAGE));
  const page = shown.slice(offset, offset + limit).map(function (o) {
    return {
      id: o.id, code: o.code, payerName: o.payerName, payerEmail: o.payerEmail,
      etransferName: o.etransferName, total: Number(o.total) || 0, status: o.status,
      createdAt: o.createdAt, paidAt: o.paidAt, paidBy: o.paidBy, notes: o.notes, remindedAt: o.remindedAt || "",
      cancelRequestedAt: o.status === "awaiting" ? (o.cancelRequestedAt || "") : "", cancelRequestedBy: o.cancelRequestedBy || "",
      tickets: (byOrder[o.id] || []).map(function (t) {
        return {
          id: t.id, name: t.name, email: t.email, ucid: t.ucid, memberId: t.memberId,
          ticketType: t.ticketType, price: Number(t.price) || 0, answers: t.answers,
          flag: t.flag, status: t.status, checkedInAt: t.checkedInAt, emailedAt: t.emailedAt,
          secret: t.secret   // execs only: lets the help desk open someone's ticket page
        };
      })
    };
  });

  return {
    ok: true,
    event: { id: event.id, name: event.name, capacity: event.capacity, capacityRule: event.capacityRule,
             ticketTypes: event.ticketTypes, questions: event.questions },
    orders: page,
    filter: filter, offset: offset, total: shown.length, hasMore: offset + page.length < shown.length,
    counts: counts,
    money: money,
    reminderHours: REMINDER_AFTER_HOURS,
    spotsTaken: spotsTaken_(event),
    unsentEmails: tickets.filter(function (t) { return t.status === "paid" && !t.emailedAt; }).length,
    emailsLeftToday: emailsLeftToday_()
  };
}

/** How many emails Google will still let this account send today (-1 when it cannot be read). */
function emailsLeftToday_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; }
}

/** Finance: the e-transfer arrived. `force` = go over capacity anyway (Finance was warned). */
function markOrderPaid_(session, orderId, force, siteUrl) {
  rememberSiteUrl_(siteUrl);
  const result = withLock_(function () { return markPaidLocked_(session, orderId, force); });
  const sent = sendPendingTicketEmails_(result.order.id);
  return { ok: true, alreadyPaid: result.already, emailsSent: sent.sent, emailsWaiting: sent.waiting };
}

/** The part of "mark paid" that changes data. Call it while holding the lock. */
function markPaidLocked_(session, orderId, force) {
  const order = readRows_("Orders").filter(function (o) { return o.id === orderId; })[0];
  if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
  if (order.status === "paid") return { already: true, order: order };
  if (order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This order was " + order.status + ". It can't be marked paid.");

  const event = findEvent_(function (e) { return e.id === order.eventId; });
  const tickets = readRows_("Tickets").filter(function (t) { return t.orderId === order.id && t.status === "awaiting"; });
  if (event && event.capacity && event.capacityRule === "paid" && !force) {
    const taken = spotsTaken_(event);
    if (taken + tickets.length > event.capacity) {
      throw new ApiError_("OVER_CAPACITY", "This would make " + (taken + tickets.length) + " paid tickets, over the capacity of " + event.capacity + ".");
    }
  }

  const now = new Date().toISOString();
  updateRow_("Orders", order.id, { status: "paid", paidAt: now, paidBy: session.name }, order._row);
  tickets.forEach(function (t) { updateRow_("Tickets", t.id, { status: "paid" }, t._row); });
  log_(session.name, "order.paid", order.code, { total: order.total, tickets: tickets.length, overCapacity: !!force });
  return { already: false, order: order };
}

/**
 * Finance: several e-transfers at once. Orders that would go over capacity are skipped
 * (and reported), never forced. The page sends a few at a time, so one call stays quick.
 */
const MAX_BULK_ORDERS = 10;

function markOrdersPaid_(session, orderIds, siteUrl) {
  rememberSiteUrl_(siteUrl);
  const ids = [];
  (Array.isArray(orderIds) ? orderIds : []).forEach(function (id) { if (id && ids.indexOf(id) === -1) ids.push(String(id)); });
  if (!ids.length) throw new ApiError_("BAD_REQUEST", "Pick at least one order.");
  if (ids.length > MAX_BULK_ORDERS) throw new ApiError_("BAD_REQUEST", "Up to " + MAX_BULK_ORDERS + " orders at a time.");

  const outcomes = withLock_(function () {
    return ids.map(function (id) {
      try {
        const r = markPaidLocked_(session, id, false);
        return { orderId: id, code: r.order.code, ok: true, already: r.already };
      } catch (err) {
        if (!(err instanceof ApiError_)) throw err;
        const o = readRows_("Orders").filter(function (x) { return x.id === id; })[0];
        return { orderId: id, code: o ? o.code : id, ok: false, error: err.code, message: err.message };
      }
    });
  });

  let sent = 0, waiting = 0;
  outcomes.forEach(function (o) {
    if (!o.ok || o.already) return;
    const r = sendPendingTicketEmails_(o.orderId);
    sent += r.sent; waiting += r.waiting;
  });
  return { ok: true, results: outcomes, emailsSent: sent, emailsWaiting: waiting };
}

/**
 * Finance: unpaid orders that have waited too long get a "please pay" email.
 * `dryRun` only counts. An order is reminded again only after another REMINDER_AFTER_HOURS.
 */
function sendReminders_(session, eventId, dryRun) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
  if (event.date < today) throw new ApiError_("BAD_REQUEST", "This event is over. No reminders needed.");

  const isDue = reminderDue_;

  let quota = 0;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { /* unknown */ }

  if (dryRun) {
    const due = readRows_("Orders").filter(function (o) { return o.eventId === eventId && isDue(o); });
    const real = due.filter(function (o) { return !isTestAddress_(o.payerEmail); });
    return { ok: true, due: due.length, toEmail: real.length, emailsLeftToday: quota };
  }

  // Claim the orders while holding the lock, so two people pressing the button can't email everyone twice.
  const claimed = withLock_(function () {
    const now = new Date().toISOString();
    const due = readRows_("Orders").filter(function (o) { return o.eventId === eventId && isDue(o); });
    const list = [];
    due.forEach(function (o) {
      if (isTestAddress_(o.payerEmail)) { updateRow_("Orders", o.id, { remindedAt: "test address, not sent" }, o._row); return; }
      if (list.length >= quota) return;
      updateRow_("Orders", o.id, { remindedAt: now }, o._row);
      list.push(o);
    });
    return list;
  });

  let sent = 0;
  const failed = [];
  const tickets = readRows_("Tickets");
  claimed.forEach(function (o) {
    const mine = tickets.filter(function (t) { return t.orderId === o.id && t.status === "awaiting"; });
    if (sendReminderEmail_(event, o, mine)) sent++; else failed.push(o);
  });
  if (failed.length) {
    withLock_(function () { failed.forEach(function (o) { updateRow_("Orders", o.id, { remindedAt: "" }, o._row); }); });
  }
  log_(session.name, "reminders.send", event.id, { sent: sent, failed: failed.length });
  return { ok: true, sent: sent, failed: failed.length };
}

/** Refund (paid) or cancel (not paid yet). The spot opens up again; nothing is deleted. */
function refundOrder_(session, orderId, reason) {
  return withLock_(function () {
    const order = readRows_("Orders").filter(function (o) { return o.id === orderId; })[0];
    if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
    if (order.status !== "paid" && order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This order is already " + order.status + ".");

    const newStatus = order.status === "paid" ? "refunded" : "cancelled";
    const note = String(reason || "").trim().slice(0, 200);
    const tickets = readRows_("Tickets").filter(function (t) { return t.orderId === order.id; });
    const checkedIn = tickets.filter(function (t) { return t.checkedInAt; }).length;
    if (checkedIn) throw new ApiError_("BAD_REQUEST", checkedIn + " ticket(s) in this order already checked in.");

    updateRow_("Orders", order.id, {
      status: newStatus,
      notes: [order.notes, newStatus + " by " + session.name + (note ? ": " + note : "")].filter(Boolean).join(" | ")
    }, order._row);
    tickets.forEach(function (t) {
      if (t.status === "paid" || t.status === "awaiting") updateRow_("Tickets", t.id, { status: newStatus }, t._row);
    });
    log_(session.name, "order." + newStatus, order.code, { total: order.total, reason: note });
    return { ok: true, status: newStatus };
  });
}

/** Sends ticket emails for paid tickets that haven't had one yet (one order, or all). */
function sendPendingTicketEmails_(orderId, limit) {
  let tickets = readRows_("Tickets").filter(function (t) {
    return t.status === "paid" && !t.emailedAt && (!orderId || t.orderId === orderId);
  });
  if (!tickets.length) return { sent: 0, waiting: 0 };
  if (limit > 0) tickets = tickets.slice(0, limit);   // oldest first: new rows go at the bottom of the sheet

  const events = {};
  allEvents_().forEach(function (e) { events[e.id] = e; });
  let sent = 0;
  tickets.forEach(function (t) {
    const event = events[t.eventId];
    if (!event) return;
    if (isTestAddress_(t.email)) {
      updateRow_("Tickets", t.id, { emailedAt: "test address, not sent" }, t._row);
      return;
    }
    if (sendTicketEmail_(event, t)) {
      updateRow_("Tickets", t.id, { emailedAt: new Date().toISOString() }, t._row);
      sent++;
    }
  });
  const waiting = readRows_("Tickets").filter(function (t) {
    return t.status === "paid" && !t.emailedAt && (!orderId || t.orderId === orderId);
  }).length;
  return { sent: sent, waiting: waiting };
}

/** Finance: email the tickets of an order again (lost email, typo fixed…). */
function resendTickets_(session, orderId, siteUrl) {
  rememberSiteUrl_(siteUrl);
  const tickets = readRows_("Tickets").filter(function (t) { return t.orderId === orderId && t.status === "paid"; });
  if (!tickets.length) throw new ApiError_("BAD_REQUEST", "No paid tickets in this order.");
  tickets.forEach(function (t) { updateRow_("Tickets", t.id, { emailedAt: "" }, t._row); });
  const result = sendPendingTicketEmails_(orderId);
  log_(session.name, "tickets.resend", orderId, result);
  return { ok: true, emailsSent: result.sent, emailsWaiting: result.waiting };
}

/**
 * Fix someone's details. Any exec can change the name and email (a new email = their ticket is
 * sent again). Everything else needs the admin password: UCID, member ID, ticket type (which
 * changes the price), answers to the event's questions, the help-desk flag, and the order's
 * payer / e-transfer name / notes. Only fields that really differ count as a change, and every
 * change is written to the Log with the old and new values.
 */
function updateTicket_(session, ticketId, changes, siteUrl, orderChanges) {
  rememberSiteUrl_(siteUrl);
  changes = changes || {};
  orderChanges = orderChanges || {};
  const isAdmin = session.role === "admin";
  const clean = function (v, max) { return String(v === undefined || v === null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max); };
  const looksLikeEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); };

  const result = withLock_(function () {
    const ticket = readRows_("Tickets").filter(function (t) { return t.id === ticketId; })[0];
    if (!ticket) throw new ApiError_("NOT_FOUND", "Ticket not found.");
    const order = readRows_("Orders").filter(function (o) { return o.id === ticket.orderId; })[0];
    const event = findEvent_(function (e) { return e.id === ticket.eventId; });

    const next = {};          // changed Tickets columns
    const orderNext = {};     // changed Orders columns
    const adminOnly = [];     // what needed the admin password (for the error message)

    // -- anyone: name, email
    if (changes.name !== undefined) {
      const name = clean(changes.name, 80);
      if (!name) throw new ApiError_("BAD_REQUEST", "Name can't be empty.");
      if (name !== ticket.name) next.name = name;
    }
    if (changes.email !== undefined) {
      const email = clean(changes.email, 120).toLowerCase();
      if (email && !looksLikeEmail(email)) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
      if (email !== ticket.email) next.email = email;
    }

    // -- admin: UCID, member ID, ticket type, answers, flag
    if (changes.ucid !== undefined) {
      const ucid = String(changes.ucid).replace(/\D/g, "").slice(0, 12);
      if (ucid !== ticket.ucid) { next.ucid = ucid; adminOnly.push("UCID"); }
    }
    if (changes.memberId !== undefined) {
      const memberId = clean(changes.memberId, 20).toUpperCase();
      if (memberId !== ticket.memberId) { next.memberId = memberId; adminOnly.push("member ID"); }
    }
    let type = event ? event.ticketTypes.filter(function (t) { return t.name === ticket.ticketType; })[0] : null;
    if (changes.ticketTypeId !== undefined && changes.ticketTypeId !== "") {
      const picked = event && event.ticketTypes.filter(function (t) { return t.id === changes.ticketTypeId; })[0];
      if (!picked) throw new ApiError_("BAD_REQUEST", "That ticket type doesn't exist for this event.");
      if (picked.name !== ticket.ticketType) {
        next.ticketType = picked.name;
        next.price = Number(picked.price) || 0;
        type = picked;
        adminOnly.push("ticket type");
      }
    }
    if (changes.answers && typeof changes.answers === "object" && event) {
      const answers = Object.assign({}, ticket.answers || {});
      event.questions.forEach(function (q) {
        if (changes.answers[q.label] === undefined) return;
        const value = clean(changes.answers[q.label], 300);
        if (value && q.type === "choice" && q.options.indexOf(value) === -1) {
          throw new ApiError_("BAD_REQUEST", "Pick one of the options for \"" + q.label + "\".");
        }
        if (value) answers[q.label] = value; else delete answers[q.label];
      });
      if (JSON.stringify(answers) !== JSON.stringify(ticket.answers || {})) { next.answers = answers; adminOnly.push("answers"); }
    }
    if (changes.flag !== undefined) {
      const flag = clean(changes.flag, 200);
      if (flag !== (ticket.flag || "")) { next.flag = flag; adminOnly.push("help-desk flag"); }
    } else if (next.ucid !== undefined || next.memberId !== undefined || next.ticketType !== undefined) {
      // The member details changed: check the Membership sheet again. Other flags (e.g. duplicate email) stay.
      const kept = String(ticket.flag || "").split("; ").filter(function (f) { return f && f.indexOf("Member price") !== 0; });
      const person = {
        memberId: next.memberId !== undefined ? next.memberId : ticket.memberId,
        ucid: next.ucid !== undefined ? next.ucid : ticket.ucid,
        needsMembership: !!(type && type.needsMembership)
      };
      const fresh = membershipFlag_(person, loadMembers_());
      const flag = (fresh ? kept.concat([fresh]) : kept).join("; ");
      if (flag !== (ticket.flag || "")) next.flag = flag;
    }

    // -- admin: the order
    if (order) {
      if (orderChanges.payerName !== undefined) {
        const v = clean(orderChanges.payerName, 80);
        if (!v) throw new ApiError_("BAD_REQUEST", "Payer name can't be empty.");
        if (v !== order.payerName) { orderNext.payerName = v; adminOnly.push("payer name"); }
      }
      if (orderChanges.payerEmail !== undefined) {
        const v = clean(orderChanges.payerEmail, 120).toLowerCase();
        if (v && !looksLikeEmail(v)) throw new ApiError_("BAD_REQUEST", "The payer's email doesn't look right.");
        if (v !== order.payerEmail) { orderNext.payerEmail = v; adminOnly.push("payer email"); }
      }
      if (orderChanges.etransferName !== undefined) {
        const v = clean(orderChanges.etransferName, 80);
        if (v !== (order.etransferName || "")) { orderNext.etransferName = v; adminOnly.push("e-transfer name"); }
      }
      if (orderChanges.notes !== undefined) {
        const v = clean(orderChanges.notes, 400);
        if (v !== (order.notes || "")) { orderNext.notes = v; adminOnly.push("order notes"); }
      }
    }

    if (adminOnly.length && !isAdmin) {
      throw new ApiError_("ADMIN_ONLY", "Changing " + adminOnly.join(", ") + " needs the admin password.");
    }
    if (!Object.keys(next).length && !Object.keys(orderNext).length) return { changed: false };

    // The payer's own ticket keeps the order's payer details in step (unless they were set on purpose above).
    if (order && order.payerEmail === ticket.email && order.payerName === ticket.name) {
      if (next.name !== undefined && orderNext.payerName === undefined) orderNext.payerName = next.name;
      if (next.email !== undefined && orderNext.payerEmail === undefined) orderNext.payerEmail = next.email;
    }

    // A different ticket type = a different price: recompute the order total.
    let total = null;
    if (next.price !== undefined && order) {
      const now = readRows_("Tickets").filter(function (t) { return t.orderId === order.id && (t.status === "paid" || t.status === "awaiting"); });
      const newTotal = now.reduce(function (sum, t) { return sum + (t.id === ticket.id ? next.price : Number(t.price) || 0); }, 0);
      total = { was: Number(order.total) || 0, now: newTotal };
      orderNext.total = newTotal;
    }

    const emailChanged = next.email !== undefined && ticket.status === "paid";
    if (emailChanged) next.emailedAt = "";
    if (Object.keys(next).length) updateRow_("Tickets", ticket.id, next, ticket._row);
    if (order && Object.keys(orderNext).length) updateRow_("Orders", order.id, orderNext, order._row);

    const from = {}, to = {};
    Object.keys(next).forEach(function (k) { if (k !== "emailedAt") { from[k] = ticket[k]; to[k] = next[k]; } });
    Object.keys(orderNext).forEach(function (k) { from["order." + k] = order[k]; to["order." + k] = orderNext[k]; });
    log_(session.name, "ticket.edit", ticket.id, { name: ticket.name, order: order ? order.code : "", from: from, to: to });
    return { changed: true, resend: emailChanged, orderId: ticket.orderId, total: total, orderStatus: order ? order.status : "" };
  });

  if (!result.changed) return { ok: true, changed: false, emailsSent: 0 };
  const sent = result.resend ? sendPendingTicketEmails_(result.orderId) : { sent: 0, waiting: 0 };
  return { ok: true, changed: true, emailsSent: sent.sent, total: result.total, orderStatus: result.orderStatus };
}

// ---- Public ticket page ---------------------------------------------------------

function getTicket_(secret) {
  const key = String(secret || "").trim();
  if (key.length < 20) throw new ApiError_("NOT_FOUND", "Ticket not found.");
  const ticket = readRows_("Tickets").filter(function (t) { return t.secret === key; })[0];
  if (!ticket) throw new ApiError_("NOT_FOUND", "Ticket not found.");
  const event = findEvent_(function (e) { return e.id === ticket.eventId; }) || {};
  const order = readRows_("Orders").filter(function (o) { return o.id === ticket.orderId; })[0] || {};
  return {
    ok: true,
    ticket: {
      id: ticket.id, name: ticket.name, ticketType: ticket.ticketType, price: Number(ticket.price) || 0,
      status: ticket.status, checkedIn: !!ticket.checkedInAt, orderCode: order.code
    },
    event: {
      name: event.name, slug: event.slug, date: event.date, startTime: event.startTime,
      endTime: event.endTime, location: event.location, imageUrl: event.imageUrl
    },
    site: siteInfo_(),
    etransferEmail: getConfig_().etransferEmail,
    orderTotal: Number(order.total) || 0,
    canGiveFeedback: ticket.status === "paid" && !!ticket.checkedInAt,
    feedback: feedbackOfTicket_(ticket),
    canRequestCancel: ticket.status === "awaiting" && order.status === "awaiting",
    cancelRequested: order.status === "awaiting" && !!order.cancelRequestedAt
  };
}

/** This ticket's saved rating ({ rating, comment }), or null. Only looked up for people who were checked in. */
function feedbackOfTicket_(ticket) {
  if (ticket.status !== "paid" || !ticket.checkedInAt) return null;
  const fb = readRows_("Feedback").filter(function (r) { return r.id === ticket.id; })[0];
  return fb ? { rating: Number(fb.rating) || 0, comment: fb.comment || "" } : null;
}

/**
 * Public, from the ticket page: someone with an UNPAID ticket says "please cancel this". Nothing is cancelled: the request is
 * written on the order and Finance decides (Refund / cancel, or Dismiss request). `undo` takes the request back.
 */
function requestCancel_(secret, undo) {
  const key = String(secret || "").trim();
  if (key.length < 20) throw new ApiError_("NOT_FOUND", "Ticket not found.");
  const done = withLock_(function () {
    const ticket = readRows_("Tickets").filter(function (t) { return t.secret === key; })[0];
    if (!ticket) throw new ApiError_("NOT_FOUND", "Ticket not found.");
    const order = readRows_("Orders").filter(function (o) { return o.id === ticket.orderId; })[0];
    if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
    if (order.status !== "awaiting" || ticket.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "Only an unpaid ticket can ask to be cancelled. Please contact us.");
    if (undo) {
      if (order.cancelRequestedAt) updateRow_("Orders", order.id, { cancelRequestedAt: "", cancelRequestedBy: "" }, order._row);
    } else if (!order.cancelRequestedAt) {
      updateRow_("Orders", order.id, { cancelRequestedAt: new Date().toISOString(), cancelRequestedBy: ticket.name }, order._row);
    }
    return { order: order, ticket: ticket };
  });
  log_("Public: " + done.ticket.name, undo ? "order.cancelRequest.undo" : "order.cancelRequest", done.order.code, {});
  return { ok: true, cancelRequested: !undo };
}

/** Finance: the person asked to cancel but Finance is keeping the order. Clears the request (no email). */
function dismissCancelRequest_(session, orderId) {
  return withLock_(function () {
    const order = readRows_("Orders").filter(function (o) { return o.id === orderId; })[0];
    if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
    if (order.cancelRequestedAt) updateRow_("Orders", order.id, { cancelRequestedAt: "", cancelRequestedBy: "" }, order._row);
    log_(session.name, "order.cancelRequest.dismiss", order.code, {});
    return { ok: true };
  });
}

// ---- Links -------------------------------------------------------------------------

/** Only these addresses may appear in ticket emails. A portal opened from anywhere else (GitHub Pages, a local folder) is ignored. */
const SITE_URL_DEFAULT = "https://events.ucalgarycss.ca/";
function allowedSiteUrl_(url) {
  return /^https:\/\/(events\.ucalgarycss\.ca|css-platform-public\.vercel\.app)\/?$/.test(String(url || "").trim());
}

/** The public site's address, remembered from the Exec Portal, for links in emails (allowed addresses only). */
function rememberSiteUrl_(url) {
  const clean = String(url || "").trim();
  if (allowedSiteUrl_(clean)) {
    PropertiesService.getScriptProperties().setProperty("PUBLIC_SITE_URL", clean.replace(/\/?$/, "/"));
  }
}

function ticketLink_(ticket) {
  // A stored address that is not on the allowed list (e.g. an old GitHub Pages one) is ignored.
  const stored = PropertiesService.getScriptProperties().getProperty("PUBLIC_SITE_URL");
  const base = allowedSiteUrl_(stored) ? String(stored).replace(/\/?$/, "/") : SITE_URL_DEFAULT;
  return base + "ticket.html?t=" + encodeURIComponent(ticket.secret);
}
