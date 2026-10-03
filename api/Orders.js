/**
 * CSS Platform API — registrations (orders and tickets).
 *
 * One registration = one Order (what gets paid, with a payment code like MGN-4821)
 * holding one Ticket per person (the payer plus any friends they pay for).
 * Tickets start as "awaiting" and become "paid" when Finance confirms the e-transfer.
 */

const MAX_TICKETS_PER_ORDER = 10;

/**
 * Public: someone registers themselves (and maybe friends) for an event. The event site and the member portal both come
 * through here, so there is one set of rules.
 *
 * `req.member` = { memberId, k } is sent by the member portal when the device holds the member's private pass key. A valid
 * key proves the person is that member: their details are filled in from the Membership sheet and the member price is
 * not questioned. Without a key a typed member ID is only a claim, and gets checked against the name (see membershipFlag_).
 */
function register_(req) {
  if (req.website) throw new ApiError_("BAD_REQUEST", "Please try again.");   // hidden field only bots fill in

  // A page that retries (slow network, "busy") sends the same requestId each time, so a retry can never create a second registration.
  const rawRid = /^[A-Za-z0-9-]{8,64}$/.test(String(req.requestId || "")) ? String(req.requestId) : "";
  const requestId = rawRid ? "regreq_" + rawRid : "";
  if (requestId) {
    const seen = CacheService.getScriptCache().get(requestId);
    if (seen) return JSON.parse(seen);
  }

  const event = findEvent_(function (e) { return e.slug === String(req.slug || "").toLowerCase(); });
  if (!event || !registrationOpen_(event)) throw new ApiError_("CLOSED", "Registration for this event is closed.");

  const rawPeople = Array.isArray(req.people) ? req.people : [];
  if (!rawPeople.length) throw new ApiError_("BAD_REQUEST", "Add at least one person.");
  if (rawPeople.length > MAX_TICKETS_PER_ORDER) throw new ApiError_("BAD_REQUEST", "Up to " + MAX_TICKETS_PER_ORDER + " tickets per registration.");

  const members = loadMembers_();
  const memberRec = verifiedMemberFromKey_(req.member, members);
  const prep = prepareRegistration_(rawPeople, event, members, memberRec);
  throttle_(prep.everyone[0].email);

  // Everything slow happens BEFORE the lock, where many requests can run side by side: open the tabs, and read
  // who is already registered (a duplicate email is only a warning, so a snapshot a moment old is fine).
  table_("Orders"); table_("Tickets");
  const etransferEmailNow = getConfig_().etransferEmail;
  const snapshotTickets = readRows_("Tickets");
  const snapshotOrders = readRows_("Orders");

  // A free order makes paid tickets straight away, which uses up room just like Mark paid does, so it also takes the
  // main lock (always after the intake lock, never the other way round). Orders that wait for payment don't need it.
  const lockFn = prep.isFree ? withIntakeAndScriptLock_ : withIntakeLock_;
  let logEntry = null;
  const done = lockFn(function () {
    if (requestId) {   // the first attempt may have finished while this one waited for the lock
      const seen = CacheService.getScriptCache().get(requestId);
      if (seen) return { repeat: JSON.parse(seen) };
    }

    // The event as it is RIGHT NOW: it may have been closed, archived or edited while this request waited.
    delete DB_.rows["Events"];
    const ev = findEvent_(function (e) { return e.id === event.id; });
    if (!ev || ev.archivedAt || !registrationOpen_(ev)) throw new ApiError_("CLOSED", "Registration for this event is closed.");
    let plan = prep;
    if (String(ev.updatedAt || "") !== String(event.updatedAt || "")) {   // edited meanwhile: prices, ticket types and questions again from the current event
      plan = prepareRegistration_(rawPeople, ev, members, memberRec);
      if (plan.isFree && !prep.isFree) throw new ApiError_("TEMPORARY", "The event was just changed. Please try again.");
    }
    const everyone = plan.everyone;
    const needsReview = plan.needsReview;

    delete DB_.rows["Orders"]; delete DB_.rows["Tickets"];   // counted and checked on fresh data, inside the lock

    // A retry of a registration that was only half written (the script stopped between the order and its tickets) finishes it.
    const prior = rawRid ? readRows_("Orders").filter(function (o) { return o.requestId === rawRid && !isFailedOrder_(o); })[0] : null;
    if (prior) {
      const resumed = resumeRegistration_(prior, plan, ev);
      const reply = registrationReply_(prior, resumed.tickets, etransferEmailNow, ev);
      if (requestId) { try { CacheService.getScriptCache().put(requestId, JSON.stringify(reply), 600); } catch (e) { /* fine */ } }
      if (resumed.madeAny) logEntry = ["Public: " + prior.payerName, "order.resumed", prior.code, { event: ev.name, tickets: resumed.tickets.length }];
      return { reply: reply, order: prior, created: resumed.tickets, noEmail: !resumed.madeAny };
    }

    if (ev.capacity && ev.capacityRule === "paid") {
      // SEC-02: "paid" counts only confirmed tickets, but sign-ups must not pile up without limit.
      // Hard stop once paid tickets reach capacity; ceiling of 125% on paid + awaiting.
      let paid = 0, awaiting = 0;
      readRows_("Tickets").forEach(function (t) {
        if (t.eventId !== ev.id) return;
        if (t.status === "paid") paid++;
        else if (t.status === "awaiting") awaiting++;
      });
      if (paid >= ev.capacity) throw new ApiError_("SOLD_OUT", "Sorry, this event is full.");
      if (paid + awaiting + everyone.length > Math.floor(ev.capacity * 1.25)) {
        throw new ApiError_("SOLD_OUT", "Registration queue is full. Please check back later.");
      }
      if (plan.isFree && paid + everyone.length > ev.capacity) {
        throw new ApiError_("SOLD_OUT", ev.capacity - paid > 0 ? "Only " + (ev.capacity - paid) + " spot(s) left." : "Sorry, this event is full.");
      }
    }
    if (ev.capacity && ev.capacityRule === "all") {
      const taken = spotsTaken_(ev);
      if (taken + everyone.length > ev.capacity) {
        throw new ApiError_("SOLD_OUT", ev.capacity - taken > 0
          ? "Only " + (ev.capacity - taken) + " spot(s) left."
          : "Sorry, this event is full.");
      }
    }
    const tickets = snapshotTickets;
    everyone.forEach(function (p) {
      const already = tickets.some(function (t) {
        return t.eventId === ev.id && t.email.toLowerCase() === p.email && (t.status === "awaiting" || t.status === "paid");
      });
      if (already) p.flag = joinFlags_(p.flag, "Already registered with this email");
    });

    const now = new Date().toISOString();
    const total = plan.total;
    const isFree = plan.isFree;   // a $0 order with a membership flag stays "awaiting" until an exec checks it
    const order = {
      id: newId_("OR"),
      code: issueOrderCode_(ev, snapshotOrders),
      eventId: ev.id,
      payerName: everyone[0].name,
      payerEmail: everyone[0].email,
      etransferName: String(req.etransferName || "").trim().slice(0, 80),
      total: total,
      status: isFree ? "paid" : "awaiting",
      createdAt: now,
      paidAt: isFree ? now : "",
      paidBy: isFree ? "Free event" : "",
      notes: total === 0 && needsReview ? "Requires exec verification of member status" : "",
      requestId: rawRid
    };
    insertRow_("Orders", order);

    const created = ticketRowsFor_(order, everyone, now);
    try {
      insertRows_("Tickets", created);
    } catch (err) {
      // The order is written but its tickets are not (or only some are). Never leave that behind: close the order
      // and anything that was written, then tell the page to try again (same requestId).
      abandonOrder_(order, err);
      throw (err instanceof ApiError_ ? err : new ApiError_("TEMPORARY", "We couldn't save your registration. Please try again in a moment."));
    }
    logEntry = ["Public: " + everyone[0].name, "order.create", order.code, { event: ev.name, tickets: created.length, total: total, member: !!memberRec }];   // written after the lock is released

    const reply = registrationReply_(order, created, etransferEmailNow, ev);
    if (requestId) { try { CacheService.getScriptCache().put(requestId, JSON.stringify(reply), 600); } catch (e) { /* fine */ } }
    return { reply: reply, order: order, created: created, ev: ev };
  });
  if (done.repeat) return done.repeat;
  if (logEntry) log_.apply(null, logEntry);
  if (done.noEmail) return done.reply;

  // Email after the lock is released, so a slow send never holds up scans or other registrations.
  const evForMail = done.ev || event;
  if (done.order.status === "paid") {
    // Free event (RSVP): everyone gets their QR ticket straight away, instead of a "payment needed" style email.
    const sent = sendPendingTicketEmails_(done.order.id);
    done.reply.emailSent = sent.sent > 0;
  } else if (done.reply.needsReview) {
    done.reply.emailSent = false;   // $0 and waiting for an exec to check membership: no ticket and no payment email yet
  } else if (eventMails_(evForMail).registration) {
    done.reply.emailSent = sendRegistrationEmail_(evForMail, done.order, done.created);
  } else {
    done.reply.emailSent = false;   // this event doesn't email a confirmation; the page shows the payment details and the ticket link instead
  }
  return done.reply;
}

/** The member a device proves it is (pass key from the emailed link), or null. A wrong or missing key is simply "not verified". */
function verifiedMemberFromKey_(creds, members) {
  if (!creds || !creds.memberId || !creds.k) return null;
  const id = String(creds.memberId).trim().toUpperCase();
  if (!linkKeyOk_("pass", id, creds.k)) return null;
  return (members || loadMembers_()).filter(function (m) { return m.memberId === id; })[0] || null;
}

/** A verified member's details come from the Membership sheet (the page's copy is only a preview). */
function fillFromMember_(raw, member) {
  const p = Object.assign({}, raw || {});
  if (!String(p.name || "").trim()) p.name = member.name;
  if (!String(p.email || "").trim()) p.email = member.email;
  p.memberId = member.memberId;
  p.ucid = member.ucid;
  return p;
}

/** Cleans every person, applies the member checks, and works out the total. Throws the same friendly errors as before. */
function prepareRegistration_(rawPeople, event, members, memberRec) {
  const people = rawPeople.slice();
  if (memberRec) people[0] = fillFromMember_(people[0], memberRec);
  const everyone = people.map(function (p, i) { return cleanPerson_(p, event, i); });
  everyone.forEach(function (p, i) {
    const verified = i === 0 && !!memberRec;
    p.flag = membershipFlag_(p, members, verified ? memberRec : null);
  });
  const total = everyone.reduce(function (sum, p) { return sum + p.price; }, 0);
  const needsReview = everyone.some(function (p) { return !!p.flag; });   // SEC-01: taken before the duplicate-email note, which is only a warning
  return { everyone: everyone, total: total, needsReview: needsReview, isFree: total === 0 && !needsReview };
}

/** The ticket rows for some people on an order. All of them start in the order's status. */
function ticketRowsFor_(order, people, now) {
  return people.map(function (p) {
    return {
      id: newTicketId_(),
      secret: Utilities.getUuid().replace(/-/g, ""),
      orderId: order.id,
      eventId: order.eventId,
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
  });
}

/** What the page needs after registering. `page` is each person's ticket page (payment status first, then the QR once paid). */
function registrationReply_(order, tickets, etransferEmail, event) {
  const needsReview = Number(order.total) === 0 && /Requires exec verification/.test(order.notes || "");
  const mails = eventMails_(event);
  return {
    ok: true,
    // What this event will email, so the page can say so (and tell people to keep the page when nothing is emailed).
    emails: { confirmation: !needsReview && order.status !== "paid" && mails.registration, ticket: !needsReview && mails.tickets },
    order: { code: order.code, total: Number(order.total) || 0, status: order.status },
    needsReview: needsReview,
    etransferEmail: etransferEmail,
    tickets: tickets.map(function (t) {
      return { name: t.name, ticketType: t.ticketType, price: Number(t.price) || 0, flag: t.flag, page: needsReview ? "" : "ticket.html?t=" + t.secret };
    })
  };
}

/** An order closed because its tickets could not be written (see abandonOrder_). */
function isFailedOrder_(o) {
  return o.status === "cancelled" && /^registration failed/.test(String(o.notes || ""));
}

/**
 * The registration's order exists but not (all of) its tickets: write the missing ones. People are matched by email and name,
 * so a retry of the same request fills only the gaps and never doubles anyone.
 */
function resumeRegistration_(prior, plan, ev) {
  const have = readRows_("Tickets").filter(function (t) { return t.orderId === prior.id; });
  const same = function (t, p) { return String(t.email || "").toLowerCase() === p.email && normalizeName_(t.name) === normalizeName_(p.name); };
  const missing = plan.everyone.filter(function (p) { return !have.some(function (t) { return same(t, p); }); });
  if (!missing.length) return { tickets: have, madeAny: false };
  const made = ticketRowsFor_(prior, missing, new Date().toISOString());
  insertRows_("Tickets", made);   // if this fails too, it propagates and the next retry resumes again
  return { tickets: have.concat(made), madeAny: true };
}

/** Close an order whose tickets could not be saved: anything that was written is cancelled too, so nothing half-finished stays live. */
function abandonOrder_(order, err) {
  try {
    delete DB_.rows["Tickets"];
    readRows_("Tickets").filter(function (t) { return t.orderId === order.id; }).forEach(function (t) {
      updateRow_("Tickets", t.id, { status: "cancelled" }, t._row);
    });
    updateRow_("Orders", order.id, { status: "cancelled", notes: "registration failed, no tickets were issued (" + String(err && err.message || err).slice(0, 80) + ")" });
    log_("system", "order.failed", order.code, { reason: String(err && err.message || err).slice(0, 120) });
  } catch (e) { /* if even this fails, a retry with the same requestId finds the order and finishes it */ }
}

/**
 * Finance: someone e-transferred (or paid cash) without registering online. Adds them as a
 * paid registration in one step. Emails their ticket. `force` = go over capacity anyway.
 */
function addOrder_(session, eventId, input, force, siteUrl) {
  rememberSiteUrl_(siteUrl);
  input = input || {};
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  assertNotArchived_(event);
  const person = cleanPerson_(input.person, event, 0, true);
  person.flag = membershipFlag_(person, loadMembers_());
  const etransferName = String(input.etransferName || "").trim().slice(0, 80);
  const note = String(input.notes || "").trim().slice(0, 200);

  const order = withIntakeAndScriptLock_(function () {
    if (event.capacity && !force) {
      const taken = spotsTaken_(event);
      if (taken + 1 > event.capacity) {
        throw new ApiError_("OVER_CAPACITY", "This would make " + (taken + 1) + " tickets, over the capacity of " + event.capacity + ".");
      }
    }
    const tickets = readRows_("Tickets");
    if (tickets.some(function (t) {
      return t.eventId === event.id && t.email.toLowerCase() === person.email && (t.status === "awaiting" || t.status === "paid");
    })) person.flag = joinFlags_(person.flag, "Already registered with this email");

    const now = new Date().toISOString();
    const created = {
      id: newId_("OR"), code: uniqueCode_(event, readRows_("Orders")), eventId: event.id,
      payerName: person.name, payerEmail: person.email, etransferName: etransferName, total: person.price,
      status: "paid", createdAt: now, paidAt: now, paidBy: session.name,
      notes: ["Added by " + session.name, note].filter(Boolean).join(" | ")
    };
    insertRow_("Orders", created);
    insertRow_("Tickets", {
      id: newTicketId_(), secret: Utilities.getUuid().replace(/-/g, ""), orderId: created.id, eventId: event.id,
      name: person.name, email: person.email, ucid: person.ucid, memberId: person.memberId,
      ticketType: person.ticketTypeName, price: person.price, answers: person.answers, flag: person.flag,
      status: "paid", checkedInAt: "", checkedInBy: "", createdAt: now
    });
    log_(session.name, "order.manual", created.code, { name: person.name, type: person.ticketTypeName, total: person.price, overCapacity: !!force });
    return created;
  });

  const sent = sendPendingTicketEmails_(order.id);
  return { ok: true, code: order.code, total: order.total, emailsSent: sent.sent, emailsWaiting: sent.waiting, notEmailed: sent.notEmailed || 0, flag: person.flag };
}

// ---- Checks -----------------------------------------------------------------

function cleanPerson_(p, event, index, lenient) {
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
  const usedKeys = {};
  event.questions.forEach(function (q) {
    // answers are stored under the wording; if an older event has two questions worded alike, the second gets "(2)" so neither is lost
    let key = q.label, n = 2;
    while (usedKeys[key]) key = q.label + " (" + (n++) + ")";
    usedKeys[key] = true;
    const value = String((p.answers || {})[q.id] || "").trim().slice(0, 300);
    if (q.required && !value && !lenient) throw new ApiError_("BAD_REQUEST", "\"" + q.label + "\" is missing for " + name + ".");
    if (value && q.type === "choice" && q.options.indexOf(value) === -1) throw new ApiError_("BAD_REQUEST", "Pick one of the options for \"" + q.label + "\".");
    if (value) answers[key] = value;
  });

  return {
    name: name, email: email, ucid: ucid, memberId: memberId,
    ticketTypeId: type.id, ticketTypeName: type.name, price: Number(type.price) || 0,
    needsMembership: !!type.needsMembership, answers: answers, flag: ""
  };
}

/**
 * Member tickets: look the person up in the Membership sheet. Never blocks, only flags (the help desk checks flagged people).
 * `verified` = the member record this device proved with its private pass key: then only "not paid yet" can still flag.
 * A typed ID or UCID alone is just a claim, so it must also fit the name, and ID and UCID must point at the same member.
 */
function membershipFlag_(person, members, verified) {
  if (!person.needsMembership) return "";
  if (verified) return verified.paid ? "" : "Member price, but membership isn't paid yet";
  if (!person.memberId && !person.ucid) return "Member price, but no member ID or UCID given";
  const byId = person.memberId ? members.filter(function (m) { return m.memberId === person.memberId; })[0] : null;
  const byUcid = person.ucid ? members.filter(function (m) { return m.ucid === person.ucid; })[0] : null;
  const match = byId || byUcid;
  if (!match) return "Member price, but no membership found";
  if (byId && byUcid && byId !== byUcid) return "Member price, but the member ID and UCID belong to different members";
  if (byId && person.ucid && byId.ucid && byId.ucid !== person.ucid) return "Member price, but the UCID doesn't match that member ID";
  if (!namesRelated_(person.name, match.name)) return "Member price, but the name doesn't match the member on file";
  if (!match.paid) return "Member price, but membership isn't paid yet";
  return "";
}

/** Do two names plausibly belong to one person? They share a word (nicknames, middle names and word order don't matter). */
function namesRelated_(a, b) {
  const x = normalizeName_(a), y = normalizeName_(b);
  if (!x || !y) return true;   // nothing to compare: don't flag on a blank
  if (x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return true;
  const words = function (t) { return t.split(" ").filter(function (w) { return w.length >= 2; }); };
  const wy = words(y);
  return words(x).some(function (w) { return wy.indexOf(w) !== -1; });
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

/**
 * A payment code that nobody has used: checked against the orders read before the lock, PLUS the codes handed out
 * in the last 10 minutes (kept in the cache), so two sign-ups at the same moment can never get the same code.
 */
function issueOrderCode_(event, orders) {
  const cache = CacheService.getScriptCache();
  const key = "recentcodes_" + event.codePrefix;
  let recent = [];
  try { recent = JSON.parse(cache.get(key) || "[]"); } catch (e) { recent = []; }
  const used = {};
  orders.forEach(function (o) { used[o.code] = true; });
  recent.forEach(function (c) { used[c] = true; });
  let code = "";
  for (let i = 0; i < 50 && !code; i++) {
    const c = event.codePrefix + "-" + (1000 + Math.floor(Math.random() * 9000));
    if (!used[c]) code = c;
  }
  if (!code) code = event.codePrefix + "-" + Date.now().toString().slice(-6);
  recent.push(code);
  try { cache.put(key, JSON.stringify(recent.slice(-300)), 600); } catch (e) { /* fine */ }
  return code;
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
  // Archived events no longer have live rows: their frozen numbers stand in
  allEvents_().forEach(function (e) {
    if (e.archivedAt && e.summary && e.summary.totals) counts[e.id] = { awaiting: e.summary.totals.awaiting || 0, paid: e.summary.totals.paid || 0, checkedIn: e.summary.totals.checkedIn || 0 };
  });
  readRows_("Tickets").forEach(function (t) {
    const c = counts[t.eventId] = counts[t.eventId] || { awaiting: 0, paid: 0, checkedIn: 0 };
    if (t.status === "awaiting") c.awaiting++;
    if (t.status === "paid") c.paid++;
    if (t.checkedInAt) c.checkedIn++;
  });
  return counts;
}

/**
 * Admin only (checked by the caller): removes ONE order and all of its tickets for good. For clearing test purchases
 * and dummy data without touching the rest of the event. Cannot be undone (the backups still hold the old rows).
 */
function deleteOrder_(session, orderId) {
  return withIntakeLock_(function () {
    return withLock_(function () {
      const order = readRows_("Orders").filter(function (o) { return o.id === orderId; })[0];
      if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
      const tickets = readRows_("Tickets").filter(function (t) { return t.orderId === orderId; });

      deleteTabRows_({ sheet: table_("Tickets"), header: headerFor_("Tickets") }, idSet_(tickets));
      deleteTabRows_({ sheet: table_("Orders"), header: headerFor_("Orders") }, { [String(order.id)]: true });
      forgetLiveRows_();   // forgets the cached Orders and Tickets, and where each ticket sat in the sheet
      delete DB_.rows["Orders"]; delete DB_.rows["Tickets"];

      log_(session.name, "order.delete", order.code, { payerName: order.payerName, total: order.total, tickets: tickets.length });
      return { ok: true, deleted: true };
    });
  });
}
