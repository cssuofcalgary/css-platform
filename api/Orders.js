/**
 * CSS Platform API — registrations (orders and tickets).
 *
 * One registration = one Order (what gets paid, with a payment code like MGN-4821)
 * holding one Ticket per person (the payer plus any friends they pay for).
 * Tickets start as "awaiting" and become "paid" when Finance confirms the e-transfer.
 */

const MAX_TICKETS_PER_ORDER = 10;

/** Public: someone registers themselves (and maybe friends) for an event. */
function register_(req) {
  if (req.website) throw new ApiError_("BAD_REQUEST", "Please try again.");   // hidden field only bots fill in

  const event = findEvent_(function (e) { return e.slug === String(req.slug || "").toLowerCase(); });
  if (!event || event.status !== "published") throw new ApiError_("CLOSED", "Registration for this event is closed.");

  const people = Array.isArray(req.people) ? req.people : [];
  if (!people.length) throw new ApiError_("BAD_REQUEST", "Add at least one person.");
  if (people.length > MAX_TICKETS_PER_ORDER) throw new ApiError_("BAD_REQUEST", "Up to " + MAX_TICKETS_PER_ORDER + " tickets per registration.");

  const payer = cleanPerson_(people[0], event, 0);
  const others = people.slice(1).map(function (p, i) { return cleanPerson_(p, event, i + 1); });
  const everyone = [payer].concat(others);
  const etransferName = String(req.etransferName || "").trim().slice(0, 80);
  throttle_(payer.email);

  const members = loadMembers_();
  everyone.forEach(function (p) { p.flag = membershipFlag_(p, members); });

  return withLock_(function () {
    const tickets = readRows_("Tickets");
    if (event.capacity && event.capacityRule === "all") {
      const taken = spotsTaken_(event);
      if (taken + everyone.length > event.capacity) {
        throw new ApiError_("SOLD_OUT", event.capacity - taken > 0
          ? "Only " + (event.capacity - taken) + " spot(s) left."
          : "Sorry, this event is full.");
      }
    }
    everyone.forEach(function (p) {
      const already = tickets.some(function (t) {
        return t.eventId === event.id && t.email.toLowerCase() === p.email && (t.status === "awaiting" || t.status === "paid");
      });
      if (already) p.flag = joinFlags_(p.flag, "Already registered with this email");
    });

    const now = new Date().toISOString();
    const total = everyone.reduce(function (sum, p) { return sum + p.price; }, 0);
    const isFree = total === 0;
    const order = {
      id: newId_("OR"),
      code: uniqueCode_(event, readRows_("Orders")),
      eventId: event.id,
      payerName: payer.name,
      payerEmail: payer.email,
      etransferName: etransferName,
      total: total,
      status: isFree ? "paid" : "awaiting",
      createdAt: now,
      paidAt: isFree ? now : "",
      paidBy: isFree ? "Free event" : "",
      notes: ""
    };
    insertRow_("Orders", order);

    const created = everyone.map(function (p) {
      const ticket = {
        id: newTicketId_(),
        secret: Utilities.getUuid().replace(/-/g, ""),
        orderId: order.id,
        eventId: event.id,
        name: p.name,
        email: p.email,
        ucid: p.ucid,
        memberId: p.memberId,
        ticketType: p.ticketTypeName,
        price: p.price,
        answers: p.answers,
        flag: p.flag,
        status: order.status,
        checkedInAt: "",
        checkedInBy: "",
        createdAt: now
      };
      insertRow_("Tickets", ticket);
      return ticket;
    });
    log_("Public: " + payer.name, "order.create", order.code, { event: event.name, tickets: created.length, total: total });

    const reply = {
      ok: true,
      order: { code: order.code, total: total, status: order.status },
      etransferEmail: getConfig_().etransferEmail,
      tickets: created.map(function (t) { return { name: t.name, ticketType: t.ticketType, price: t.price, flag: t.flag }; })
    };
    reply.emailSent = sendRegistrationEmail_(event, order, created);
    return reply;
  });
}

// ---- Checks -----------------------------------------------------------------

function cleanPerson_(p, event, index) {
  p = p || {};
  const who = index === 0 ? "Your" : "Friend " + index + "'s";
  const name = String(p.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const email = String(p.email || "").trim().toLowerCase().slice(0, 120);
  if (!name) throw new ApiError_("BAD_REQUEST", who + " name is missing.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError_("BAD_REQUEST", who + " email doesn't look right.");

  const type = event.ticketTypes.filter(function (t) { return t.id === p.ticketTypeId; })[0];
  if (!type) throw new ApiError_("BAD_REQUEST", "Pick a ticket type for " + name + ".");

  const ucid = String(p.ucid || "").replace(/\D/g, "").slice(0, 12);
  const memberId = String(p.memberId || "").trim().toUpperCase().slice(0, 20);

  const answers = {};
  event.questions.forEach(function (q) {
    const value = String((p.answers || {})[q.id] || "").trim().slice(0, 300);
    if (q.required && !value) throw new ApiError_("BAD_REQUEST", "\"" + q.label + "\" is missing for " + name + ".");
    if (value && q.type === "choice" && q.options.indexOf(value) === -1) throw new ApiError_("BAD_REQUEST", "Pick one of the options for \"" + q.label + "\".");
    if (value) answers[q.label] = value;
  });

  return {
    name: name, email: email, ucid: ucid, memberId: memberId,
    ticketTypeId: type.id, ticketTypeName: type.name, price: Number(type.price) || 0,
    needsMembership: !!type.needsMembership, answers: answers, flag: ""
  };
}

/** Member tickets: look the person up in the Membership sheet. Never blocks, only flags. */
function membershipFlag_(person, members) {
  if (!person.needsMembership) return "";
  if (!person.memberId && !person.ucid) return "Member price, but no member ID or UCID given";
  const match = members.filter(function (m) {
    return (person.memberId && m.memberId === person.memberId) || (person.ucid && m.ucid === person.ucid);
  })[0];
  if (!match) return "Member price, but no membership found";
  if (!match.paid) return "Member price, but membership isn't paid yet";
  return "";
}

function joinFlags_(a, b) {
  return a ? a + "; " + b : b;
}

/** Stops the same email from registering over and over (bots, double-taps): max 5 per 10 min. */
function throttle_(email) {
  const cache = CacheService.getScriptCache();
  const key = "reg_" + Utilities.base64EncodeWebSafe(email).slice(0, 200);
  const count = parseInt(cache.get(key) || "0", 10);
  if (count >= 5) throw new ApiError_("TOO_MANY_TRIES", "Too many registrations from this email. Try again in 10 minutes.");
  cache.put(key, String(count + 1), 600);
}

// ---- IDs & codes --------------------------------------------------------------

/** Payment code people put in their e-transfer message: event letters + 4 digits, unique per event. */
function uniqueCode_(event, orders) {
  const used = {};
  orders.forEach(function (o) { used[o.code] = true; });
  for (let i = 0; i < 50; i++) {
    const code = event.codePrefix + "-" + (1000 + Math.floor(Math.random() * 9000));
    if (!used[code]) return code;
  }
  return event.codePrefix + "-" + Date.now().toString().slice(-6);
}

function newTicketId_() {
  // TKT + 8 characters without look-alikes (no 0/O, 1/I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "TKT";
  for (let i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

// ---- Counts for the Events list -------------------------------------------------

function registrationCounts_() {
  const counts = {};
  readRows_("Tickets").forEach(function (t) {
    const c = counts[t.eventId] = counts[t.eventId] || { awaiting: 0, paid: 0, checkedIn: 0 };
    if (t.status === "awaiting") c.awaiting++;
    if (t.status === "paid") c.paid++;
    if (t.checkedInAt) c.checkedIn++;
  });
  return counts;
}
