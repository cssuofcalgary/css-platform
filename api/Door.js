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
function scan_(session, eventId, code, atDesk) {
  const key = ticketKey_(code);
  if (!key) return scanResult_("red", "Couldn't read that code.");
  if (key.kind === "member") return scanResult_("red", "That's a membership card, not a ticket for this event.");

  table_("Tickets");   // open the spreadsheet BEFORE taking the lock, where other requests can do the same in parallel
  let logEntry = null;
  const result = withLock_(function () {
    const event = findEvent_(function (e) { return e.id === eventId; });
    if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");

    // Straight to this one ticket's row, read fresh from the sheet (never the shared cache) for the decision.
    const ticket = findTicketFresh_(key.kind, key.value);
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
    // Flagged tickets (membership not found, duplicate email...) only get in through the help desk.
    if (ticket.flag && !atDesk) {
      return scanResult_("orange", "Please go to the help desk: " + ticket.flag + ".", person);
    }

    const now = new Date().toISOString();
    updateRow_("Tickets", ticket.id, { checkedInAt: now, checkedInBy: session.name }, ticket._row, true);   // row was just read fresh
    logEntry = [session.name, atDesk ? "checkin.desk" : "checkin", ticket.id, { name: ticket.name, flag: ticket.flag || "" }];   // written after the lock is released
    return scanResult_("green", ticket.flag ? "Checked in at the help desk." : "Checked in. Welcome!", person);
  });
  if (logEntry) log_.apply(null, logEntry);
  return result;
}

/** Exec: take back a check-in (scanned the wrong person, or scanned twice by mistake). */
function undoCheckIn_(session, ticketId) {
  return withLock_(function () {
    const ticket = readRows_("Tickets").filter(function (t) { return t.id === ticketId; })[0];
    if (!ticket) throw new ApiError_("NOT_FOUND", "Ticket not found.");
    if (!ticket.checkedInAt) return { ok: true, already: true };
    updateRow_("Tickets", ticket.id, { checkedInAt: "", checkedInBy: "" }, ticket._row);
    log_(session.name, "checkin.undo", ticket.id, { name: ticket.name, wasBy: ticket.checkedInBy, wasAt: ticket.checkedInAt });
    return { ok: true };
  });
}

/** Exec: someone pays at the door. Always accepted, even when sold out. */
function walkIn_(session, eventId, input) {
  input = input || {};
  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new ApiError_("BAD_REQUEST", "Walk-in needs a name.");
  const method = input.method === "etransfer" ? "e-transfer" : "cash";

  return withIntakeLock_(function () {
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
    return { ok: true, result: scanResult_("green", "Walk-in added and checked in (" + moneyText_(order.total) + " " + method + ")." + (flag ? " Note: " + flag : ""), personView_(ticket)).result };
  });
}

const DOOR_LIST_CAP = 100;       // unpaid / needs-checking people sent with the list
const DOOR_RECENT = 10;
const DOOR_SEARCH_MAX = 20;

/**
 * Exec: what the door screen needs, kept small: the counts for the whole event, the people who still need the
 * help desk (not paid / flagged, up to DOOR_LIST_CAP each) and the latest check-ins. The full guest list is NOT
 * sent (scans don't need it). `q` (typed search) returns up to 20 matches in `matches`.
 */
function doorList_(eventId, session, opts) {
  opts = opts || {};
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const doorOnly = !!session && session.role === "door";
  if (doorOnly && !event.entryOpen) throw new ApiError_("DOOR_CLOSED", DOOR_CLOSED_TEXT);
  const orders = {};
  readRows_("Orders").forEach(function (o) { if (o.eventId === eventId) orders[o.id] = o; });
  const active = readRows_("Tickets")
    .filter(function (t) { return t.eventId === eventId && t.status !== "cancelled" && t.status !== "refunded"; });

  const view = function (t) {
    const order = orders[t.orderId] || {};
    if (doorOnly) {   // a door volunteer sees who is coming and who is inside, not payment details or answers
      return { id: t.id, name: t.name, ticketType: t.ticketType, status: t.status, flag: t.flag ? "see help desk" : "", checkedInAt: t.checkedInAt, checkedInBy: t.checkedInBy };
    }
    return {
      id: t.id, secret: t.secret, name: t.name, ticketType: t.ticketType, status: t.status, flag: t.flag,
      checkedInAt: t.checkedInAt, checkedInBy: t.checkedInBy, answers: t.answers,
      orderId: t.orderId, orderCode: order.code, orderTotal: Number(order.total) || 0,
      payerName: order.payerName, etransferName: order.etransferName
    };
  };
  const byName = function (a, b) { return a.name.localeCompare(b.name); };

  const unpaid = active.filter(function (t) { return t.status === "awaiting"; });
  const flagged = active.filter(function (t) { return t.status === "paid" && t.flag && !t.checkedInAt; });
  const inside = active.filter(function (t) { return t.checkedInAt; });
  const recent = inside.slice().sort(function (a, b) { return String(b.checkedInAt).localeCompare(String(a.checkedInAt)); }).slice(0, DOOR_RECENT);

  // the small lists, each person once
  const seen = {}, tickets = [];
  unpaid.slice(0, DOOR_LIST_CAP).concat(flagged.slice(0, DOOR_LIST_CAP), recent).forEach(function (t) {
    if (!seen[t.id]) { seen[t.id] = true; tickets.push(view(t)); }
  });
  tickets.sort(byName);

  const reply = {
    ok: true,
    event: { id: event.id, name: event.name, entryOpen: event.entryOpen, ticketTypes: event.ticketTypes },
    tickets: tickets,
    counts: {
      paid: active.filter(function (t) { return t.status === "paid"; }).length,
      checkedIn: inside.length,
      awaiting: unpaid.length,
      flagged: flagged.length
    }
  };

  const q = String(opts.q || "").trim().toLowerCase();
  if (q.length >= 2) {
    reply.matches = active.filter(function (t) {
      const o = orders[t.orderId] || {};
      return doorOnly ? String(t.name).toLowerCase().indexOf(q) !== -1
        : [t.name, o.code, o.payerName, o.etransferName].some(function (v) { return String(v || "").toLowerCase().indexOf(q) !== -1; });
    }).sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, DOOR_SEARCH_MAX).map(view);
  }
  return reply;
}

// A door volunteer signs in on the scanner page with just their name (plus the door password,
// if the admin set one in Settings). It only works while at least one event has entry open, and it
// can only scan, undo a check-in, and see the open events. Closing entry locks it out again.

const DOOR_CLOSED_TEXT = "Door scanning is closed right now. An exec has to open entry first.";
const DOOR_ACTIONS = ["listEvents", "doorList", "scan", "undoCheckIn", "logout"];

function entryOpenEvents_() {
  return allEvents_().filter(function (e) { return e.entryOpen && e.status !== "archived" && e.status !== "draft"; });
}

function loginDoor_(password, name) {
  const who = String(name || "").trim().slice(0, 60);
  if (!who) throw new ApiError_("NAME_NEEDED", "Type your name.");
  const cache = CacheService.getScriptCache();
  const failed = parseInt(cache.get("failed_logins") || "0", 10);
  if (failed >= MAX_FAILED_LOGINS) throw new ApiError_("TOO_MANY_TRIES", "Too many wrong passwords. Try again in 10 minutes.");

  const required = String(PropertiesService.getScriptProperties().getProperty("SCANNER_PASSWORD") || "");
  if (required) {
    const typed = String(password || "");
    if (!typed) throw new ApiError_("DOOR_PASSWORD_NEEDED", "Ask an exec for the door password.");
    if (typed !== required) {
      cache.put("failed_logins", String(failed + 1), 600);
      throw new ApiError_("WRONG_PASSWORD", "Wrong password.");
    }
  }
  if (!entryOpenEvents_().length) throw new ApiError_("DOOR_CLOSED", DOOR_CLOSED_TEXT);
  warmCaches_(true);
  return { ok: true, token: startSession_(who, "door"), name: who, role: "door" };
}

/** Called for every door-only request: only door actions, and only while some entry is open. */
function checkDoorSession_(action) {
  if (DOOR_ACTIONS.indexOf(action) === -1) throw new ApiError_("DOOR_ONLY", "Door sign-in can only scan tickets.");
  if (action !== "logout" && !entryOpenEvents_().length) throw new ApiError_("DOOR_CLOSED", DOOR_CLOSED_TEXT);
}

/** The events list for a door volunteer: only events with entry open, nothing else. */
function doorEvents_() {
  const events = entryOpenEvents_().map(function (e) {
    return { id: e.id, name: e.name, date: e.date, startTime: e.startTime, endTime: e.endTime, location: e.location, status: e.status, entryOpen: true, ticketTypes: [], questions: [] };
  });
  return { ok: true, events: events, counts: {} };
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
