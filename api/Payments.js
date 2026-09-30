/**
 * CSS Platform API — payments (Finance) and tickets.
 *
 * Finance checks the CSS Gmail for the e-transfer, finds the order by its payment
 * code or name, and marks it paid. Every ticket in the order becomes "paid" and
 * each person is emailed their own ticket (a link to their ticket page + QR code).
 */

/** Orders for one event, each with its tickets, newest first. */
function listOrders_(eventId) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const tickets = readRows_("Tickets").filter(function (t) { return t.eventId === eventId; });
  const orders = readRows_("Orders")
    .filter(function (o) { return o.eventId === eventId; })
    .map(function (o) {
      return {
        id: o.id, code: o.code, payerName: o.payerName, payerEmail: o.payerEmail,
        etransferName: o.etransferName, total: Number(o.total) || 0, status: o.status,
        createdAt: o.createdAt, paidAt: o.paidAt, paidBy: o.paidBy, notes: o.notes,
        tickets: tickets.filter(function (t) { return t.orderId === o.id; }).map(function (t) {
          return {
            id: t.id, name: t.name, email: t.email, ucid: t.ucid, memberId: t.memberId,
            ticketType: t.ticketType, price: Number(t.price) || 0, answers: t.answers,
            flag: t.flag, status: t.status, checkedInAt: t.checkedInAt, emailedAt: t.emailedAt,
            secret: t.secret   // execs only: lets the help desk open someone's ticket page
          };
        })
      };
    })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  return {
    ok: true,
    event: { id: event.id, name: event.name, capacity: event.capacity, capacityRule: event.capacityRule,
             ticketTypes: event.ticketTypes, questions: event.questions },
    orders: orders,
    spotsTaken: spotsTaken_(event),
    unsentEmails: tickets.filter(function (t) { return t.status === "paid" && !t.emailedAt; }).length
  };
}

/** Finance: the e-transfer arrived. `force` = go over capacity anyway (Finance was warned). */
function markOrderPaid_(session, orderId, force, siteUrl) {
  rememberSiteUrl_(siteUrl);
  const result = withLock_(function () {
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
    updateRow_("Orders", order.id, { status: "paid", paidAt: now, paidBy: session.name });
    tickets.forEach(function (t) { updateRow_("Tickets", t.id, { status: "paid" }); });
    log_(session.name, "order.paid", order.code, { total: order.total, tickets: tickets.length, overCapacity: !!force });
    return { already: false, order: order };
  });

  const sent = sendPendingTicketEmails_(result.order.id);
  return { ok: true, alreadyPaid: result.already, emailsSent: sent.sent, emailsWaiting: sent.waiting };
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
    });
    tickets.forEach(function (t) {
      if (t.status === "paid" || t.status === "awaiting") updateRow_("Tickets", t.id, { status: newStatus });
    });
    log_(session.name, "order." + newStatus, order.code, { total: order.total, reason: note });
    return { ok: true, status: newStatus };
  });
}

/** Sends ticket emails for paid tickets that haven't had one yet (one order, or all). */
function sendPendingTicketEmails_(orderId) {
  const tickets = readRows_("Tickets").filter(function (t) {
    return t.status === "paid" && !t.emailedAt && (!orderId || t.orderId === orderId);
  });
  if (!tickets.length) return { sent: 0, waiting: 0 };

  const events = {};
  allEvents_().forEach(function (e) { events[e.id] = e; });
  let sent = 0;
  tickets.forEach(function (t) {
    const event = events[t.eventId];
    if (!event) return;
    if (isTestAddress_(t.email)) {
      updateRow_("Tickets", t.id, { emailedAt: "test address, not sent" });
      return;
    }
    if (sendTicketEmail_(event, t)) {
      updateRow_("Tickets", t.id, { emailedAt: new Date().toISOString() });
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
  tickets.forEach(function (t) { updateRow_("Tickets", t.id, { emailedAt: "" }); });
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
    etransferEmail: getConfig_().etransferEmail,
    orderTotal: Number(order.total) || 0
  };
}

// ---- Links -------------------------------------------------------------------------

/** The public site's address, remembered from the Exec Portal, for links in emails. */
function rememberSiteUrl_(url) {
  const clean = String(url || "").trim();
  if (/^https?:\/\/[^\s"<>]+$/.test(clean)) {
    PropertiesService.getScriptProperties().setProperty("PUBLIC_SITE_URL", clean.replace(/\/?$/, "/"));
  }
}

function ticketLink_(ticket) {
  const base = PropertiesService.getScriptProperties().getProperty("PUBLIC_SITE_URL") || "";
  return base + "ticket.html?t=" + encodeURIComponent(ticket.secret);
}
