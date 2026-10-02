/**
 * CSS Platform API — what happened at events: feedback ratings, the event report, and a member's history.
 *
 * Feedback: someone who was checked in can rate the event 1 to 5 stars (and leave a comment) from their ticket page.
 * One rating per ticket (rating again replaces it). Each one is saved with the member's ID when we can tell who they are,
 * so it shows on their profile. Nothing here sends email.
 * Report and history are read-only and only run when an exec presses the button.
 */

const FEEDBACK_COMMENT_MAX = 500;

/** The member a ticket belongs to: by member ID first, then UCID, then email. Blank fields never match. */
function memberOfTicket_(ticket, members) {
  const id = String(ticket.memberId || "").trim().toUpperCase();
  const ucid = String(ticket.ucid || "").replace(/\D/g, "");
  const email = String(ticket.email || "").trim().toLowerCase();
  let found = null;
  (members || []).forEach(function (m) {
    if (found) return;
    if (id && m.memberId === id) found = m;
  });
  if (found) return found;
  (members || []).forEach(function (m) {
    if (found) return;
    if (ucid && String(m.ucid || "").replace(/\D/g, "") === ucid) found = m;
    else if (email && String(m.email || "").toLowerCase() === email) found = m;
  });
  return found;
}

function membersQuietly_() {
  try { return loadMembers_(); } catch (e) { return []; }
}

// ---- Feedback ---------------------------------------------------------------------------

/** Public (ticket page). Saves or replaces this ticket's rating. Only for a paid ticket that was checked in. */
function submitFeedback_(req) {
  const key = String(req.secret || "").trim();
  if (key.length < 20) throw new ApiError_("NOT_FOUND", "Ticket not found.");
  const rating = Math.round(Number(req.rating));
  if (!(rating >= 1 && rating <= 5)) throw new ApiError_("BAD_REQUEST", "Pick 1 to 5 stars.");
  const comment = memberText_(req.comment, FEEDBACK_COMMENT_MAX);
  const members = membersQuietly_();

  const ticket = withLock_(function () {
    const t = readRows_("Tickets").filter(function (x) { return x.secret === key; })[0];
    if (!t) throw new ApiError_("NOT_FOUND", "Ticket not found.");
    if (t.status !== "paid" || !t.checkedInAt) throw new ApiError_("BAD_REQUEST", "Feedback opens once you have been checked in at the event.");
    const now = new Date().toISOString();
    const memberId = t.memberId || (memberOfTicket_(t, members) || {}).memberId || "";
    const mine = readRows_("Feedback").filter(function (r) { return r.id === t.id; })[0];
    if (mine) {
      updateRow_("Feedback", t.id, { rating: rating, comment: comment, memberId: memberId, updatedAt: now }, mine._row);
    } else {
      insertRow_("Feedback", { id: t.id, eventId: t.eventId, memberId: memberId, name: t.name, rating: rating, comment: comment, createdAt: now, updatedAt: now });
    }
    return t;
  });
  log_("Public: " + ticket.name, "feedback.save", ticket.id, { rating: rating });
  return { ok: true, feedback: { rating: rating, comment: comment } };
}

/** The numbers and comments for one event. */
function feedbackSummary_(eventId) {
  const rows = readRows_("Feedback").filter(function (r) { return r.eventId === eventId; });
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  rows.forEach(function (r) {
    const n = Number(r.rating) || 0;
    if (n >= 1 && n <= 5) { distribution[n - 1]++; sum += n; }
  });
  const count = distribution.reduce(function (a, b) { return a + b; }, 0);
  return {
    count: count,
    average: count ? Math.round(sum / count * 10) / 10 : null,
    distribution: distribution,
    comments: rows.filter(function (r) { return r.comment; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
      .slice(0, 100)
      .map(function (r) { return { name: r.name, rating: Number(r.rating) || 0, comment: r.comment, createdAt: r.createdAt }; })
  };
}

// ---- Event report (on demand) -------------------------------------------------------------

/** One call, everything a "how did it go" write-up needs. Read-only; runs when an exec presses the button. */
function eventReport_(session, eventId) {
  const s = eventSummary_(eventId, { filter: "all", full: true });
  const event = findEvent_(function (e) { return e.id === eventId; });
  const members = membersQuietly_();
  const live = s.attendees.filter(function (a) { return a.status === "paid" || a.status === "awaiting"; });
  const paid = live.filter(function (a) { return a.status === "paid"; });

  let memberCount = 0;
  paid.forEach(function (a) { const m = memberOfTicket_(a, members); if (m && m.paid) memberCount++; });
  const walkIns = paid.filter(function (a) { return /^walk-in/i.test(String((a.order || {}).notes || "")); }).length;

  const perDay = {};
  live.forEach(function (a) {
    if (!a.createdAt) return;
    const day = Utilities.formatDate(new Date(a.createdAt), "America/Edmonton", "yyyy-MM-dd");
    perDay[day] = (perDay[day] || 0) + 1;
  });
  const byDay = Object.keys(perDay).sort().map(function (day) { return { day: day, tickets: perDay[day] }; });

  const checkedInPaid = paid.filter(function (a) { return a.checkedInAt; }).length;
  log_(session.name, "event.report", eventId, {});
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    generatedBy: session.name,
    event: { name: event.name, date: event.date, startTime: event.startTime, endTime: event.endTime, location: event.location, capacity: event.capacity },
    totals: s.totals,
    money: s.money,
    paidTickets: paid.length,
    checkedInPaid: checkedInPaid,
    attendanceRate: paid.length ? Math.round(checkedInPaid / paid.length * 100) : null,
    members: { members: memberCount, others: paid.length - memberCount },
    walkIns: walkIns,
    byType: s.byType,
    questions: s.questions,
    byDay: byDay,
    feedback: feedbackSummary_(eventId)
  };
}

// ---- A member's history ----------------------------------------------------------------------

const MEMBER_HISTORY_ARCHIVED_MAX = 12;   // yearly archives are slower to open, so only the most recent archived events are read

/** Events a member registered for (by ID, UCID or email), whether they showed up, and what they rated. */
function memberHistory_(session, memberId) {
  const member = findMemberById_(loadMembers_(), memberId);
  if (!member) throw new ApiError_("NOT_FOUND", "No member with that ID.");
  const mine = function (t) { return !!memberOfTicket_(t, [member]); };

  const feedback = {};
  readRows_("Feedback").forEach(function (r) { feedback[r.id] = r; });

  const events = allEvents_().filter(function (e) { return e.status !== "draft"; })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  const entries = [];
  let archivedRead = 0, archivedSkipped = 0;
  events.forEach(function (e) {
    if (e.archivedAt) {
      if (archivedRead >= MEMBER_HISTORY_ARCHIVED_MAX) { archivedSkipped++; return; }
      archivedRead++;
    }
    let tickets = [];
    try { tickets = eventRows_("Tickets", e); } catch (err) { tickets = []; }
    tickets.filter(mine).forEach(function (t) {
      const fb = feedback[t.id];
      entries.push({
        eventId: e.id, eventName: e.name, date: e.date, ticketId: t.id, ticketType: t.ticketType, price: Number(t.price) || 0,
        status: t.status, checkedInAt: t.checkedInAt || "",
        rating: fb ? Number(fb.rating) || 0 : 0, comment: fb ? fb.comment : ""
      });
    });
  });
  const counted = entries.filter(function (x) { return x.status === "paid" || x.status === "awaiting"; });
  return {
    ok: true,
    entries: entries,
    registered: counted.length,
    attended: counted.filter(function (x) { return x.checkedInAt; }).length,
    rated: entries.filter(function (x) { return x.rating; }).length,
    olderNotShown: archivedSkipped
  };
}
