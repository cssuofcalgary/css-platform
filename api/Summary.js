/**
 * CSS Platform API — event summary.
 *
 * One call gives the Attendees view everything: the headline numbers, money, counts
 * per ticket type, the answers people gave to the custom questions (e.g. "32 Milk tea,
 * 18 Taro") and the full attendee list. Read-only.
 */

function eventSummary_(eventId) {
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

  const attendees = all.map(function (t) {
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
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

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
    attendees: attendees
  };
}
