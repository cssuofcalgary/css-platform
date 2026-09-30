/**
 * CSS Platform API — event summary.
 *
 * One call gives the Attendees view everything: the headline numbers, money, counts
 * per ticket type, the answers people gave to the custom questions (e.g. "32 Milk tea,
 * 18 Taro") and the full attendee list. Read-only.
 */

const ATTENDEES_PAGE = 50;
const ATTENDEES_PAGE_MAX = 500;

/**
 * opts: { filter, q, sort (name|type|newest), offset, limit, full }. The numbers always cover the whole
 * event; `attendees` is ONE PAGE of the filtered list (`full: true` = everyone, for the spreadsheet download).
 */
function eventSummary_(eventId, opts) {
  opts = opts || {};
  const event = findEvent_(function (e) { return e.id === eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");

  const orders = {};
  readRows_("Orders").forEach(function (o) { if (o.eventId === eventId) orders[o.id] = o; });
  const all = readRows_("Tickets").filter(function (t) { return t.eventId === eventId; });
  const isActive = function (t) { return t.status === "paid" || t.status === "awaiting"; };
  const active = all.filter(isActive);
  const paid = active.filter(function (t) { return t.status === "paid"; });
  const checkedIn = active.filter(function (t) { return t.checkedInAt; });

  let received = 0, waiting = 0;
  Object.keys(orders).forEach(function (id) {
    const o = orders[id];
    if (o.status === "paid") received += Number(o.total) || 0;
    if (o.status === "awaiting") waiting += Number(o.total) || 0;
  });

  // Per ticket type (the event's own types first, then any old names still on tickets)
  const typeNames = event.ticketTypes.map(function (t) { return t.name; });
  active.forEach(function (t) { if (typeNames.indexOf(t.ticketType) === -1) typeNames.push(t.ticketType); });
  const byType = typeNames.map(function (name) {
    const mine = active.filter(function (t) { return t.ticketType === name; });
    return {
      name: name,
      paid: mine.filter(function (t) { return t.status === "paid"; }).length,
      awaiting: mine.filter(function (t) { return t.status === "awaiting"; }).length,
      checkedIn: mine.filter(function (t) { return t.checkedInAt; }).length
    };
  });

  // Answers to the custom questions, counted (most popular first)
  const questions = event.questions.map(function (q) {
    const tally = {};
    active.forEach(function (t) {
      const answer = (t.answers || {})[q.label];
      if (!answer) return;
      const row = tally[answer] = tally[answer] || { answer: answer, paid: 0, awaiting: 0 };
      row[t.status]++;
    });
    const answers = Object.keys(tally).map(function (k) { return tally[k]; })
      .sort(function (a, b) { return (b.paid + b.awaiting) - (a.paid + a.awaiting) || a.answer.localeCompare(b.answer); });
    return { label: q.label, type: q.type, answers: answers.slice(0, 60) };
  });

  const everyone = all.map(function (t) {
    const o = orders[t.orderId] || {};
    return {
      id: t.id, name: t.name, email: t.email, ucid: t.ucid, memberId: t.memberId,
      ticketType: t.ticketType, price: Number(t.price) || 0, status: t.status, flag: t.flag,
      answers: t.answers || {}, checkedInAt: t.checkedInAt, checkedInBy: t.checkedInBy,
      createdAt: t.createdAt, emailedAt: t.emailedAt,
      order: {
        id: o.id, code: o.code, status: o.status, total: Number(o.total) || 0,
        payerName: o.payerName, payerEmail: o.payerEmail, etransferName: o.etransferName, notes: o.notes
      }
    };
  });

  const closedStatus = function (t) { return t.status === "refunded" || t.status === "cancelled"; };
  const matchesFilter = function (a) {
    switch (opts.filter) {
      case "paid": return a.status === "paid";
      case "awaiting": return a.status === "awaiting";
      case "inside": return !!a.checkedInAt && !closedStatus(a);
      case "notArrived": return a.status === "paid" && !a.checkedInAt;
      case "flagged": return !!a.flag && !closedStatus(a);
      case "closed": return closedStatus(a);
      case "all": return true;
      default: return !closedStatus(a);   // "active"
    }
  };
  const q = String(opts.q || "").trim().toLowerCase();
  const sorters = {
    name: function (a, b) { return a.name.localeCompare(b.name); },
    type: function (a, b) { return a.ticketType.localeCompare(b.ticketType) || a.name.localeCompare(b.name); },
    newest: function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }
  };
  const matching = everyone.filter(matchesFilter).filter(function (a) {
    return !q || [a.name, a.email, a.ucid, a.memberId, a.order.code, a.order.etransferName, a.order.payerName]
      .some(function (v) { return String(v || "").toLowerCase().indexOf(q) !== -1; });
  }).sort(sorters[opts.sort] || sorters.name);
  const offset = opts.full ? 0 : Math.max(0, parseInt(opts.offset, 10) || 0);
  const limit = opts.full ? matching.length : Math.min(ATTENDEES_PAGE_MAX, Math.max(1, parseInt(opts.limit, 10) || ATTENDEES_PAGE));
  const attendees = matching.slice(offset, offset + limit);

  const taken = spotsTaken_(event);
  return {
    ok: true,
    event: {
      id: event.id, name: event.name, date: event.date, capacity: event.capacity, capacityRule: event.capacityRule,
      ticketTypes: event.ticketTypes, questions: event.questions
    },
    totals: {
      registered: active.length,
      paid: paid.length,
      awaiting: active.length - paid.length,
      checkedIn: checkedIn.length,
      notArrived: paid.length - paid.filter(function (t) { return t.checkedInAt; }).length,
      flagged: active.filter(function (t) { return t.flag; }).length,
      closed: all.length - active.length
    },
    spotsTaken: taken,
    spotsLeft: event.capacity ? Math.max(event.capacity - taken, 0) : null,
    money: { received: received, awaiting: waiting },
    byType: byType,
    questions: questions,
    attendees: attendees,
    attTotal: matching.length, attOffset: offset, attHasMore: offset + attendees.length < matching.length
  };
}
