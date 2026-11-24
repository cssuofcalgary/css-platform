/**
 * CSS Platform API — practice mode for event day.
 *
 * One button makes a "PRACTICE (not real)" event full of clearly fake attendees, one for each thing volunteers meet at the
 * door: paid, unpaid (single and group), member-price problems, refunded, cancelled, already inside, a scan twice, drinks.
 * The practice sheet lists each one with its QR code and what scanning it should show. One button removes it all again.
 *
 * Safe by design: the event is "closed" (not on the public site, takes no sign-ups), every address is @example.com (never
 * emailed), it's left out of Needs attention, and removing it deletes only rows of that one event.
 */

const PRACTICE_NAME = "PRACTICE (not real)";

// expect: GREEN = let in, ORANGE = help desk / already in, RED = not valid
const PRACTICE_PEOPLE = [
  { name: "Practice Paige Paid", type: "n", expect: "GREEN", note: "Plain paid ticket." },
  { name: "Practice Max Member", type: "m", expect: "GREEN", member: "CSS0000000", note: "Paid member ticket." },
  { name: "Practice Fay Free", type: "f", expect: "GREEN", note: "Free ticket." },
  { name: "Practice Drew Drink", type: "n", drink: "Mango green tea", expect: "GREEN", note: "Shows the drink choice (Mango green tea)." },
  { name: "Practice Gina Group", type: "n", group: "g", expect: "GREEN", note: "Group of 3, all paid: each person has their own code." },
  { name: "Practice Gus Group", type: "n", group: "g", expect: "GREEN", note: "Group of 3." },
  { name: "Practice Gil Group", type: "f", group: "g", expect: "GREEN", note: "Group of 3." },
  { name: "Practice Ursula Unpaid", type: "n", status: "awaiting", expect: "ORANGE", note: "Not paid: the help desk takes $8 (Mark paid), then scan again for green." },
  { name: "Practice Uma Unpaid", type: "n", status: "awaiting", group: "u", expect: "ORANGE", note: "Unpaid group of 2: Mark paid covers both." },
  { name: "Practice Ula Unpaid", type: "n", status: "awaiting", group: "u", expect: "ORANGE", note: "Unpaid group of 2." },
  { name: "Practice Nina NoMembership", type: "m", flag: "Member price, but no membership found", expect: "ORANGE", note: "Member ticket, not a member: help desk decides (charge the difference or let in)." },
  { name: "Practice Ned NoMemberId", type: "m", flag: "Member price, but no member ID or UCID given", expect: "ORANGE", note: "Member ticket, no ID given: help desk checks." },
  { name: "Practice Rex Refunded", type: "n", status: "refunded", expect: "RED", note: "Refunded: must never get in." },
  { name: "Practice Cal Cancelled", type: "n", status: "cancelled", expect: "RED", note: "Cancelled registration: not valid." },
  { name: "Practice Ian Inside", type: "n", inside: true, expect: "ORANGE", note: "Already checked in 30 minutes ago: someone may be sharing a screenshot." },
  { name: "Practice Tess Twice", type: "n", expect: "GREEN", note: "Scan twice in a row: the second scan says already checked in. Then try Undo." }
];

function practiceEvent_() {
  return allEvents_().filter(isPracticeEvent_).sort(function (a, b) { return Number(a.status === "archived") - Number(b.status === "archived"); })[0] || null;
}

function isPracticeEvent_(event) { return !!event && (event.summary || {}).practice === true; }

function createPracticeEvent_(session) {
  const made = withIntakeAndScriptLock_(function () {
    delete DB_.rows.Events;
    if (practiceEvent_()) return { already: true };
    const now = new Date().toISOString();
    const today = Utilities.formatDate(new Date(), "America/Edmonton", "yyyy-MM-dd");
    const types = { m: { id: newId_("TT"), name: "Member", price: 3, needsMembership: true },
      n: { id: newId_("TT"), name: "Non-member", price: 8, needsMembership: false }, f: { id: newId_("TT"), name: "Free", price: 0, needsMembership: false } };
    const drink = { id: newId_("Q"), label: "Which drink would you like?", type: "choice", options: ["Pearl milk tea", "Mango green tea"], required: false, forTickets: [] };
    const event = {
      id: newId_("EV"), slug: uniqueSlug_("practice-not-real", allEvents_()), name: PRACTICE_NAME,
      description: "Practice data for event-day training. Remove it from Events when you're done.", date: today, startTime: "", endTime: "",
      location: "Practice", capacity: "", capacityRule: "paid", status: "closed", entryOpen: false, imageFileId: "", imageUrl: "",
      ticketTypes: [types.m, types.n, types.f], questions: [drink], codePrefix: "PR", registrationCloses: "",
      mailRegistration: false, mailTickets: false, mailReminders: false,
      summary: { practice: true }, createdBy: session.name, createdAt: now, updatedBy: session.name, updatedAt: now
    };
    const orders = readRows_("Orders").slice();
    const newOrders = [], tickets = [];
    const groupOrders = {};
    const insideAt = new Date(Date.now() - 30 * 60000).toISOString();
    PRACTICE_PEOPLE.forEach(function (p, i) {
      const type = types[p.type];
      const status = p.status || "paid";
      const email = "practice-" + (i + 1) + "@example.com";
      let order = p.group ? groupOrders[p.group] : null;
      if (!order) {
        order = { id: newId_("OR"), code: uniqueCode_(event, orders), eventId: event.id, payerName: p.name, payerEmail: email, etransferName: "",
          total: 0, status: status, createdAt: now, paidAt: status === "paid" ? now : "", paidBy: status === "paid" ? "Practice" : "",
          notes: "Practice data", received: status === "paid" ? 0 : "0" };
        orders.push(order);
        newOrders.push(order);
        if (p.group) groupOrders[p.group] = order;
      }
      order.total = (Number(order.total) || 0) + type.price;
      if (status === "paid" || status === "refunded") order.received = String(order.total);
      const answers = {};
      if (p.drink) answers[drink.label] = p.drink;
      tickets.push({
        id: newTicketId_(), secret: Utilities.getUuid().replace(/-/g, ""), orderId: order.id, eventId: event.id, name: p.name, email: email,
        ucid: "", memberId: p.member || "", ticketType: type.name, price: type.price, answers: answers, flag: p.flag || "", status: status,
        checkedInAt: p.inside ? insideAt : "", checkedInBy: p.inside ? "Practice volunteer" : "", createdAt: now, emailedAt: "practice, no email"
      });
    });
    try {
      insertRow_("Events", event);
      insertRows_("Orders", newOrders);
      insertRows_("Tickets", tickets);
    } catch (error) {
      // A failed batch must not leave a half-built practice event. Only IDs made above can be removed.
      const cleanup = { Events: [event], Orders: newOrders, Tickets: tickets };
      let childrenRemoved = true;
      ["Tickets", "Orders", "Events"].forEach(function (name) {
        if (name === "Events" && !childrenRemoved) return; // leave the tagged event available for Remove practice event
        const ids = {};
        cleanup[name].forEach(function (row) { ids[row.id] = true; });
        try { deleteTabRows_({ sheet: table_(name), header: headerFor_(name) }, ids); } catch (e) { childrenRemoved = false; rememberError_("practice.cleanup." + name, e); }
        dropTableCache_(name);
      });
      forgetTicketRowIndex_();
      throw error;
    }
    return { event: event };
  });
  if (!made.already) log_(session.name, "practice.create", made.event.id, { name: PRACTICE_NAME, people: PRACTICE_PEOPLE.length });
  return practiceSheet_();
}

/** The practice sheet: every fake attendee with the link their QR code holds and what scanning it should show. */
function practiceSheet_() {
  const event = practiceEvent_();
  if (!event) return { ok: true, exists: false };
  const byEmail = {};
  eventRows_("Tickets", event).forEach(function (t) { byEmail[t.email] = t; });
  const cards = [];
  PRACTICE_PEOPLE.forEach(function (p, i) {
    const t = byEmail["practice-" + (i + 1) + "@example.com"];
    if (!t) return;
    cards.push({ n: i + 1, name: p.name, ticketType: t.ticketType, ticketId: t.id, expect: p.expect, note: p.note, link: ticketLink_(t) });
  });
  cards.push({ n: cards.length + 1, name: "Not a real ticket", ticketType: "", ticketId: "", expect: "RED", note: "A made-up code: should say the ticket wasn't found.",
    link: ticketLink_({ secret: Utilities.getUuid().replace(/-/g, "") }) });
  return { ok: true, exists: true, archived: event.status === "archived" || !!event.archivedAt, eventId: event.id, eventName: event.name, cards: cards };
}

/** Deletes the practice event and only its own orders, tickets and the rest (see deleteEvent_). Never touches a real event. */
function removePracticeEvent_(session) {
  const event = practiceEvent_();
  if (!event) return { ok: true, removed: false };
  if (!isPracticeEvent_(event)) throw new ApiError_("BAD_REQUEST", "That isn't the practice event.");
  deleteEvent_(session, event.id, event.name, true);
  log_(session.name, "practice.remove", event.id, { name: event.name });
  return { ok: true, removed: true };
}
