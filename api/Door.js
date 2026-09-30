/**
 * CSS Platform API — the door.
 *
 * Scanning a ticket QR (or typing a ticket ID) answers green / orange / red and
 * checks the person in. Scans run one at a time on the server, so two phones
 * scanning the same ticket can't both let it in. Walk-ins are added and checked
 * in on the spot. The help-desk list shows who hasn't paid yet or needs a check.
 */

/** Exec: open or close entry for an event. Scanners won't check anyone in while it's closed. */
function setEntryOpen_(session, eventId, open) {
  return withLock_(function () {
    updateRow_("Events", eventId, { entryOpen: !!open, updatedBy: session.name, updatedAt: new Date().toISOString() });
    log_(session.name, open ? "entry.open" : "entry.close", eventId, {});
    return { ok: true, entryOpen: !!open };
  });
}

/**
 * Exec: a QR code was scanned (or a ticket ID typed).
 * `code` can be a ticket link (…ticket.html?t=SECRET), a bare secret, or a ticket ID (TKT…).
 */
function scan_(session, eventId, code) {
  const key = ticketKey_(code);
  if (!key) return scanResult_("red", "Couldn't read that code.");
  if (key.kind === "member") return scanResult_("red", "That's a membership card, not a ticket for this event.");

  return withLock_(function () {
    const event = findEvent_(function (e) { return e.id === eventId; });
    if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");

    const ticket = readRows_("Tickets").filter(function (t) {
      return key.kind === "secret" ? t.secret === key.value : t.id === key.value;
    })[0];
    if (!ticket) return scanResult_("red", "Ticket not found.");

    const person = personView_(ticket);
    if (ticket.eventId !== event.id) {
      const other = findEvent_(function (e) { return e.id === ticket.eventId; });
      return scanResult_("red", "This ticket is for " + (other ? other.name : "another event") + ".", person);
    }
    if (ticket.status === "refunded" || ticket.status === "cancelled") {
      return scanResult_("red", "This ticket was " + ticket.status + ".", person);
    }
    if (ticket.status === "awaiting") {
      const order = readRows_("Orders").filter(function (o) { return o.id === ticket.orderId; })[0] || {};
      return scanResult_("orange", "Not paid yet. Send to the help desk (" + (order.code || "") + ", " + moneyText_(order.total) + ").", person);
    }
    if (ticket.checkedInAt) {
      return scanResult_("orange", "Already checked in at " + clockText_(ticket.checkedInAt) + " by " + (ticket.checkedInBy || "someone") + ".", person);
    }
    if (!event.entryOpen) {
      return scanResult_("orange", "Valid ticket, but entry is closed. Open entry to check people in.", person);
    }

    const now = new Date().toISOString();
    updateRow_("Tickets", ticket.id, { checkedInAt: now, checkedInBy: session.name }, ticket._row);
    log_(session.name, "checkin", ticket.id, { name: ticket.name });
    return scanResult_(ticket.flag ? "green-flag" : "green", ticket.flag ? "Checked in. Please check: " + ticket.flag : "Checked in. Welcome!", person);
  });
}

/** Exec: someone pays at the door. Always accepted, even when sold out. */
function walkIn_(session, eventId, input) {
  input = input || {};
  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new ApiError_("BAD_REQUEST", "Walk-in needs a name.");
  const method = input.method === "etransfer" ? "e-transfer" : "cash";

  return withLock_(function () {
    const event = findEvent_(function (e) { return e.id === eventId; });
    if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
    const type = event.ticketTypes.filter(function (t) { return t.id === input.ticketTypeId; })[0];
    if (!type) throw new ApiError_("BAD_REQUEST", "Pick a ticket type.");

    const now = new Date().toISOString();
    const person = {
      name: name, email: String(input.email || "").trim().toLowerCase().slice(0, 120),
      ucid: String(input.ucid || "").replace(/\D/g, "").slice(0, 12),
      memberId: String(input.memberId || "").trim().toUpperCase().slice(0, 20),
      needsMembership: !!type.needsMembership
    };
    const flag = type.needsMembership ? membershipFlag_(person, loadMembers_()) : "";

    const order = {
      id: newId_("OR"), code: uniqueCode_(event, readRows_("Orders")), eventId: event.id,
      payerName: name, payerEmail: person.email, etransferName: "", total: Number(type.price) || 0,
      status: "paid", createdAt: now, paidAt: now, paidBy: session.name,
      notes: "Walk-in, paid by " + method
    };
    insertRow_("Orders", order);
    const ticket = {
      id: newTicketId_(), secret: Utilities.getUuid().replace(/-/g, ""), orderId: order.id, eventId: event.id,
      name: name, email: person.email, ucid: person.ucid, memberId: person.memberId,
      ticketType: type.name, price: Number(type.price) || 0, answers: {}, flag: flag, status: "paid",
      checkedInAt: now, checkedInBy: session.name, createdAt: now, emailedAt: "walk-in, no email"
    };
    insertRow_("Tickets", ticket);
    log_(session.name, "walkin", order.code, { name: name, type: type.name, total: order.total, method: method });
    return { ok: true, result: scanResult_(flag ? "green-flag" : "green", "Walk-in added and checked in (" + moneyText_(order.total) + " " + method + ")." + (flag ? " Please check: " + flag : ""), personView_(ticket)).result };
  });
}

/** Exec: everything the door needs for one event. */
function doorList_(eventId) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const orders = {};
  readRows_("Orders").forEach(function (o) { if (o.eventId === eventId) orders[o.id] = o; });
  const tickets = readRows_("Tickets")
    .filter(function (t) { return t.eventId === eventId && t.status !== "cancelled" && t.status !== "refunded"; })
    .map(function (t) {
      const order = orders[t.orderId] || {};
      return {
        id: t.id, secret: t.secret, name: t.name, ticketType: t.ticketType, status: t.status, flag: t.flag,
        checkedInAt: t.checkedInAt, checkedInBy: t.checkedInBy, answers: t.answers,
        orderId: t.orderId, orderCode: order.code, orderTotal: Number(order.total) || 0,
        payerName: order.payerName, etransferName: order.etransferName
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });

  return {
    ok: true,
    event: { id: event.id, name: event.name, entryOpen: event.entryOpen, ticketTypes: event.ticketTypes },
    tickets: tickets,
    counts: {
      paid: tickets.filter(function (t) { return t.status === "paid"; }).length,
      checkedIn: tickets.filter(function (t) { return t.checkedInAt; }).length,
      awaiting: tickets.filter(function (t) { return t.status === "awaiting"; }).length
    }
  };
}

// ---- Helpers ------------------------------------------------------------------

/** Works out what was scanned: a ticket link, a bare secret, a ticket ID, or a member card. */
function ticketKey_(code) {
  const raw = String(code || "").trim();
  if (!raw) return null;
  const fromLink = /[?&]t=([A-Za-z0-9]+)/.exec(raw);
  if (fromLink) return { kind: "secret", value: fromLink[1] };
  if (/^[a-f0-9]{32}$/i.test(raw)) return { kind: "secret", value: raw.toLowerCase() };
  const id = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^TKT[A-Z0-9]{6,}$/.test(id)) return { kind: "id", value: id };
  if (/^CSS/.test(id) || /member\.ucalgarycss\.ca/i.test(raw)) return { kind: "member" };
  return null;
}

function personView_(ticket) {
  return { id: ticket.id, name: ticket.name, ticketType: ticket.ticketType, answers: ticket.answers || {}, flag: ticket.flag };
}

function scanResult_(color, message, person) {
  return { ok: true, result: { color: color, message: message, person: person || null } };
}

function clockText_(iso) {
  return Utilities.formatDate(new Date(iso), "America/Edmonton", "h:mm a");
}
