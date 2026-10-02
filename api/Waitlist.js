/**
 * CSS Platform API — the waitlist.
 *
 * An event can switch on a waitlist (Events → Edit → Capacity). When the event is full, the public page shows
 * "Join the waitlist" instead of "Sold out". A person on the waitlist has no ticket, no QR and no payment code, and takes
 * no spot. They get one short "you're on the waitlist" email.
 *
 * Nothing moves by itself. When a spot opens (a cancel or refund), the VP Finance presses "Offer a spot" next to a name on
 * the Payments tab (Waitlist). That creates a normal registration for that person, with the usual payment email, and marks the
 * entry "offered". An offer is held for WAITLIST_HOLD_HOURS: after that Finance cancels it by hand and offers the next person.
 */

const WAITLIST_MAX_PER_EVENT = 200;   // keeps a bot from filling the sheet
const WAITLIST_HOLD_HOURS = 48;       // shown to Finance so they know when an offer has gone stale (nothing expires on its own)

/** True when the public can't sign up right now: sold out, or (when only paid tickets count) the queue of unpaid sign-ups is at its limit. */
function eventFull_(event) {
  if (!event.capacity) return false;
  let paid = 0, awaiting = 0;
  readRows_("Tickets").forEach(function (t) {
    if (t.eventId !== event.id) return;
    if (t.status === "paid") paid++;
    else if (t.status === "awaiting") awaiting++;
  });
  if (event.capacityRule === "all") return paid + awaiting >= event.capacity;
  return paid >= event.capacity || paid + awaiting >= Math.floor(event.capacity * 1.25);
}

/** How many spots could still be offered: capacity minus the spots taken minus offers still waiting for payment. */
function waitlistRoom_(event) {
  const entries = readRows_("Waitlist").filter(function (w) { return w.eventId === event.id; });
  const orders = {};
  readRows_("Orders").forEach(function (o) { if (o.eventId === event.id) orders[o.id] = o; });
  const outstanding = entries.filter(function (w) {
    return w.status === "offered" && orders[w.orderId] && orders[w.orderId].status === "awaiting";
  }).length;
  let paid = 0, awaiting = 0;
  readRows_("Tickets").forEach(function (t) {
    if (t.eventId !== event.id) return;
    if (t.status === "paid") paid++;
    else if (t.status === "awaiting") awaiting++;
  });
  let free = null;
  if (event.capacity) {
    free = event.capacityRule === "all" ? event.capacity - paid - awaiting : event.capacity - paid - outstanding;
    free = Math.max(0, free);
  }
  return { free: free, outstanding: outstanding };
}

/** The little summary the Payments tab needs (waiting count, free spots). */
function waitlistSummary_(event) {
  if (event.archivedAt) return { enabled: false, waiting: 0, offered: 0, free: null };
  const entries = readRows_("Waitlist").filter(function (w) { return w.eventId === event.id; });
  const waiting = entries.filter(function (w) { return w.status === "waiting"; }).length;
  const offered = entries.filter(function (w) { return w.status === "offered"; }).length;
  if (!event.waitlist && !entries.length) return { enabled: false, waiting: 0, offered: 0, free: null };
  return { enabled: !!event.waitlist, waiting: waiting, offered: offered, free: waitlistRoom_(event).free };
}

// ---- Public: join -------------------------------------------------------------------------

function joinWaitlist_(req) {
  if (req.website) throw new ApiError_("BAD_REQUEST", "Please try again.");   // hidden field only bots fill in
  const event = findEvent_(function (e) { return e.slug === String(req.slug || "").toLowerCase(); });
  if (!event || !registrationOpen_(event)) throw new ApiError_("CLOSED", "Registration for this event is closed.");
  if (!event.waitlist) throw new ApiError_("BAD_REQUEST", "This event doesn't have a waitlist.");
  const person = cleanPerson_(req.person, event, 0);
  throttle_(person.email);

  const done = withIntakeLock_(function () {
    delete DB_.rows["Tickets"]; delete DB_.rows["Waitlist"];   // counted on fresh data, inside the lock
    if (!eventFull_(event)) throw new ApiError_("NOT_FULL", "There are spots available again. Please register instead.");
    const hasTicket = readRows_("Tickets").some(function (t) {
      return t.eventId === event.id && String(t.email).toLowerCase() === person.email && (t.status === "awaiting" || t.status === "paid");
    });
    if (hasTicket) throw new ApiError_("BAD_REQUEST", "You already have a ticket for this event.");
    const entries = readRows_("Waitlist").filter(function (w) { return w.eventId === event.id; });
    const mine = entries.filter(function (w) { return String(w.email).toLowerCase() === person.email && (w.status === "waiting" || w.status === "offered"); })[0];
    if (mine) return { already: true };
    if (entries.filter(function (w) { return w.status === "waiting"; }).length >= WAITLIST_MAX_PER_EVENT) throw new ApiError_("WAITLIST_FULL", "The waitlist is full.");
    insertRow_("Waitlist", {
      id: newId_("WL"), eventId: event.id, name: person.name, email: person.email, ucid: person.ucid, memberId: person.memberId,
      ticketTypeId: person.ticketTypeId, ticketType: person.ticketTypeName, answers: person.answers, status: "waiting",
      createdAt: new Date().toISOString(), offeredAt: "", offeredBy: "", orderId: "", orderCode: "", notes: ""
    });
    return { already: false };
  });
  if (!done.already) {
    log_("Public: " + person.name, "waitlist.join", event.id, { type: person.ticketTypeName });
    sendWaitlistEmail_(event, person);
  }
  return { ok: true, already: !!done.already };
}

function sendWaitlistEmail_(event, person) {
  if (!canSendMail_(person.email)) return false;
  try {
    const t = mailText_("waitlist", { name: person.name, event: event.name, when: eventWhenText_(event), where: event.location || "TBA" });
    const body = t.intro + mailBox_(mailRows_(whenWhereRows_(event))) + t.closing;
    sendStyled_(person.email, t.subject, emailShell_({ preheader: "You're on the waitlist for " + event.name, title: t.title, subtitle: t.subtitle, body: body }),
      "You're on the waitlist for " + event.name + ". We'll write to you if a spot opens.");
    return true;
  } catch (e) {
    console.error("Waitlist email failed: " + e.message); rememberError_("email", e);
    return false;
  }
}

// ---- Exec: the list, offer a spot, remove ----------------------------------------------------

function listWaitlist_(eventId) {
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const entries = readRows_("Waitlist").filter(function (w) { return w.eventId === event.id && w.status !== "removed"; })
    .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });   // sign-up order
  let place = 0;
  const list = entries.map(function (w) {
    return {
      id: w.id, name: w.name, email: w.email, ucid: w.ucid, memberId: w.memberId, ticketType: w.ticketType, answers: w.answers || {},
      status: w.status, createdAt: w.createdAt, offeredAt: w.offeredAt, offeredBy: w.offeredBy, orderCode: w.orderCode,
      position: w.status === "waiting" ? ++place : 0
    };
  });
  const room = event.archivedAt ? { free: null, outstanding: 0 } : waitlistRoom_(event);
  return { ok: true, entries: list, free: room.free, outstanding: room.outstanding, holdHours: WAITLIST_HOLD_HOURS, enabled: !!event.waitlist };
}

/**
 * Finance: a spot opened, so make a real registration for this person (the usual payment email goes out). `force` = offer
 * even though no spot looks free (Finance was warned).
 */
function offerWaitlistSpot_(session, entryId, force, siteUrl) {
  rememberSiteUrl_(siteUrl);
  const members = membersQuietly_();
  const made = withIntakeLock_(function () {
    const entry = readRows_("Waitlist").filter(function (w) { return w.id === entryId; })[0];
    if (!entry) throw new ApiError_("NOT_FOUND", "That waitlist entry no longer exists.");
    if (entry.status !== "waiting") throw new ApiError_("BAD_REQUEST", "This person is already " + entry.status + ".");
    const event = findEvent_(function (e) { return e.id === entry.eventId; });
    if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
    assertNotArchived_(event);
    const type = event.ticketTypes.filter(function (t) { return t.id === entry.ticketTypeId; })[0];
    if (!type) throw new ApiError_("BAD_REQUEST", "The ticket type this person picked no longer exists on the event. Remove them or add it back.");

    if (event.capacity && !force) {
      const room = waitlistRoom_(event);
      if (room.free < 1) {
        throw new ApiError_("OVER_CAPACITY", "No spot looks free right now (" + room.outstanding + " earlier offer(s) still waiting for payment). Offer anyway?");
      }
    }
    const person = { name: entry.name, email: entry.email, ucid: entry.ucid, memberId: entry.memberId, needsMembership: !!type.needsMembership };
    const flag = membershipFlag_(person, members);
    const price = Number(type.price) || 0;
    const needsReview = price === 0 && !!flag;
    const isFree = price === 0 && !flag;
    const now = new Date().toISOString();
    const order = {
      id: newId_("OR"), code: uniqueCode_(event, readRows_("Orders")), eventId: event.id,
      payerName: entry.name, payerEmail: entry.email, etransferName: "", total: price,
      status: isFree ? "paid" : "awaiting", createdAt: now, paidAt: isFree ? now : "", paidBy: isFree ? "Waitlist offer" : "",
      notes: "From the waitlist (offered by " + session.name + ")" + (needsReview ? ". Requires exec verification of member status" : ""),
      cancelRequestedAt: "", cancelRequestedBy: ""
    };
    const ticket = {
      id: newTicketId_(), secret: Utilities.getUuid().replace(/-/g, ""), orderId: order.id, eventId: event.id,
      name: entry.name, email: entry.email, ucid: entry.ucid, memberId: entry.memberId, ticketType: type.name, price: price,
      answers: entry.answers || {}, flag: flag, status: order.status, checkedInAt: "", checkedInBy: "", createdAt: now
    };
    insertRow_("Orders", order);
    insertRow_("Tickets", ticket);
    updateRow_("Waitlist", entry.id, { status: "offered", offeredAt: now, offeredBy: session.name, orderId: order.id, orderCode: order.code }, entry._row);
    return { event: event, order: order, ticket: ticket, isFree: isFree, needsReview: needsReview };
  });
  log_(session.name, "waitlist.offer", made.order.code, { name: made.ticket.name, total: made.order.total });

  let emailed = false;
  if (made.isFree) emailed = sendPendingTicketEmails_(made.order.id).sent > 0;
  else if (!made.needsReview) emailed = sendRegistrationEmail_(made.event, made.order, [made.ticket]);
  return { ok: true, code: made.order.code, status: made.order.status, emailed: emailed, needsReview: made.needsReview };
}

/** Finance: take someone off the waitlist (they asked, or never replied). The entry is kept, marked removed. */
function removeWaitlistEntry_(session, entryId) {
  return withLock_(function () {
    const entry = readRows_("Waitlist").filter(function (w) { return w.id === entryId; })[0];
    if (!entry) throw new ApiError_("NOT_FOUND", "That waitlist entry no longer exists.");
    if (entry.status !== "removed") {
      updateRow_("Waitlist", entry.id, { status: "removed", notes: [entry.notes, "removed by " + session.name].filter(Boolean).join(" | ") }, entry._row);
      log_(session.name, "waitlist.remove", entry.id, { name: entry.name });
    }
    return { ok: true };
  });
}
