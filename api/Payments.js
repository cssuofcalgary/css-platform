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
    event: { id: event.id, name: event.name, capacity: event.capacity, capacityRule: event.capacityRule },
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

/** Finance/help desk: fix a typo in someone's name or email. A new email = their ticket is sent again. */
function updateTicket_(session, ticketId, changes, siteUrl) {
  rememberSiteUrl_(siteUrl);
  changes = changes || {};
  const result = withLock_(function () {
    const ticket = readRows_("Tickets").filter(function (t) { return t.id === ticketId; })[0];
    if (!ticket) throw new ApiError_("NOT_FOUND", "Ticket not found.");
    const name = changes.name === undefined ? ticket.name : String(changes.name).trim().replace(/\s+/g, " ").slice(0, 80);
    const email = changes.email === undefined ? ticket.email : String(changes.email).trim().toLowerCase().slice(0, 120);
    if (!name) throw new ApiError_("BAD_REQUEST", "Name can't be empty.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError_("BAD_REQUEST", "That email doesn't look right.");
    const emailChanged = email !== ticket.email;
    if (name === ticket.name && !emailChanged) return { changed: false };

    updateRow_("Tickets", ticket.id, emailChanged && ticket.status === "paid"
      ? { name: name, email: email, emailedAt: "" } : { name: name, email: email }, ticket._row);
    const order = readRows_("Orders").filter(function (o) { return o.id === ticket.orderId; })[0];
    if (order && order.payerEmail === ticket.email && order.payerName === ticket.name) {
      updateRow_("Orders", order.id, { payerName: name, payerEmail: email }, order._row);
    }
    log_(session.name, "ticket.edit", ticket.id, { from: { name: ticket.name, email: ticket.email }, to: { name: name, email: email } });
    return { changed: true, resend: emailChanged && ticket.status === "paid", orderId: ticket.orderId };
  });
  const sent = result.resend ? sendPendingTicketEmails_(result.orderId) : { sent: 0, waiting: 0 };
  return { ok: true, changed: result.changed, emailsSent: sent.sent };
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
