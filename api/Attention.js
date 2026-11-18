/**
 * CSS Platform API — "Needs attention": the things someone has to act on, from every live event at once, each with its next step.
 *
 *   review   a payment or refund that was cut off and couldn't be finished safely (NEEDS_REVIEW): check the order, then "Done"
 *   refunds  money owed back that hasn't been returned yet
 *   emails   paid tickets whose email hasn't gone out (failed or waiting): "Send now"
 *   offer    a waitlist offer whose payment instructions never arrived: "Resend offer"
 *   card     a paid member whose membership card email didn't send: "Resend card"
 *
 * Read-only apart from the two small actions at the bottom. Nothing here runs on a timer.
 */

const ATTENTION_MAX_PER_KIND = 30;
const REVIEW_DAYS = 60;   // a "check this order" older than this is assumed sorted out

function attentionList_() {
  const items = [];
  const events = {};
  allEvents_().forEach(function (e) { if (!e.archivedAt && e.status !== "archived" && e.status !== "draft") events[e.id] = e; });
  const orders = {};
  readRows_("Orders").forEach(function (o) { orders[o.id] = o; });
  const eventName = function (id) { return events[id] ? events[id].name : ""; };

  // ---- Payments that couldn't be finished safely
  const since = Date.now() - REVIEW_DAYS * 86400000;
  readRows_("Requests").filter(function (r) {
    return r.status === "done" && r.reply && r.reply.error === "NEEDS_REVIEW" && Date.parse(r.doneAt || r.createdAt) >= since;
  }).slice(-ATTENTION_MAX_PER_KIND).reverse().forEach(function (r) {
    const ids = Array.isArray(r.reply.conflicts) ? r.reply.conflicts : [];
    const first = orders[ids[0]] || {};
    items.push({
      kind: "review", id: r.id, eventId: first.eventId || "", eventName: eventName(first.eventId),
      codes: ids.map(function (id) { return orders[id] ? orders[id].code : id; }), who: r.who || "", when: r.doneAt || r.createdAt,
      what: r.action === "invalidateTickets" ? "refund" : "payment"
    });
  });

  // ---- Per event: refunds owed, ticket emails not sent, waitlist offers not delivered
  const owedBy = {}, unsentBy = {};
  readRows_("Refunds").forEach(function (r) {
    if (r.status !== "owed" || !events[r.eventId]) return;
    const left = cents_(refundView_(r).remaining);
    if (left <= 0) return;
    const x = owedBy[r.eventId] = owedBy[r.eventId] || { count: 0, cents: 0 };
    x.count++; x.cents += left;
  });
  readRows_("Tickets").forEach(function (t) {
    if (t.status === "paid" && events[t.eventId] && ticketUnsent_(t)) unsentBy[t.eventId] = (unsentBy[t.eventId] || 0) + 1;
  });
  Object.keys(events).forEach(function (id) {
    if (owedBy[id]) items.push({ kind: "refunds", eventId: id, eventName: eventName(id), count: owedBy[id].count, amount: dollars_(owedBy[id].cents) });
    if (unsentBy[id] && eventMails_(events[id]).tickets) items.push({ kind: "emails", eventId: id, eventName: eventName(id), count: unsentBy[id] });
  });
  readRows_("Waitlist").filter(function (w) {
    const o = orders[w.orderId];
    return w.status === "offered" && events[w.eventId] && o && o.status === "awaiting" && String(w.offerEmail || "").indexOf("failed") === 0;
  }).slice(0, ATTENTION_MAX_PER_KIND).forEach(function (w) {
    items.push({ kind: "offer", id: w.id, eventId: w.eventId, eventName: eventName(w.eventId), name: w.name, code: w.orderCode });
  });

  // ---- Members marked paid whose card email didn't go out ("Pending" = joined through the site and never sent)
  try {
    loadMembers_().filter(function (m) { return m.paid && m.email && String(m.mailStatus || "").toLowerCase() === "pending"; })
      .slice(0, ATTENTION_MAX_PER_KIND).forEach(function (m) { items.push({ kind: "card", id: m.memberId, name: m.name }); });
  } catch (e) { items.push({ kind: "membersUnreadable" }); }   // the membership sheet couldn't be read: say so rather than "all clear"

  return { ok: true, items: items };
}

/** Finance checked an order a cut-off payment named: take it off the list. The saved answer stays, so the old press still can't repeat. */
function dismissReview_(session, requestRowId) {
  return withLock_(function () {
    const row = savedRequestRow_(requestRowId);
    if (!row) throw new ApiError_("NOT_FOUND", "That item is no longer on the list.");
    if (row.status !== "reviewed") {
      updateRow_("Requests", row.id, { status: "reviewed" }, row._row);
      log_(session.name, "payment.reviewed", (row.reply && row.reply.conflicts || []).join(","), { request: row.id });
    }
    return { ok: true };
  });
}

function savedRequestRow_(id) {
  delete DB_.rows["Requests"];
  return readRows_("Requests").filter(function (r) { return r.id === String(id || ""); })[0] || null;
}

/** "Resend card" from Needs attention: sends the membership card again and, when it went out, marks it Sent so it leaves the list. */
function resendMemberCard_(session, memberId) {
  const reply = resendMemberPass_(session, memberId);   // throws EMAIL_FAILED when it still can't send
  try {
    withIntakeLock_(function () {
      const book = openMemberSheet_();
      const fresh = book.members.filter(function (m) { return m.memberId === String(memberId || "").trim().toUpperCase(); })[0];
      if (fresh) setMemberCells_(book, fresh, { mailStatus: "Sent" });
    });
  } catch (e) { console.error("Card sent, but couldn't mark it Sent: " + e.message); }
  return reply;
}

/** F6: send a waitlist offer's payment instructions again (the first email failed, or the person lost it). */
function resendWaitlistOffer_(session, entryId) {
  const entry = readRows_("Waitlist").filter(function (w) { return w.id === entryId; })[0];
  if (!entry || entry.status !== "offered") throw new ApiError_("NOT_FOUND", "That waitlist offer no longer exists.");
  const order = readRows_("Orders").filter(function (o) { return o.id === entry.orderId; })[0];
  if (!order || order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This offer isn't waiting for payment any more" + (order ? " (" + order.status + ")" : "") + ".");
  const event = findEvent_(function (e) { return e.id === order.eventId; });
  if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
  const tickets = readRows_("Tickets").filter(function (t) { return t.orderId === order.id && t.status === "awaiting"; });
  const emailed = sendRegistrationEmail_(event, order, tickets);
  recordOfferEmail_(entry, emailed);
  log_(session.name, "waitlist.resend", order.code, { emailed: emailed ? 1 : 0 });
  return { ok: true, emailed: emailed, code: order.code };
}

/** Writes down whether a waitlist offer's email went out, so a failed one shows in Needs attention. Never fails the caller. */
function recordOfferEmail_(entry, emailed) {
  try {
    withLock_(function () { updateRow_("Waitlist", entry.id, { offerEmail: (emailed ? "sent:" : "failed:") + new Date().toISOString() }); });
  } catch (e) { console.error("Could not note the offer email: " + e.message); }
}
