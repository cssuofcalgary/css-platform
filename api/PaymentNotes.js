/**
 * CSS Platform API — comments on a payment (an order).
 *
 * Execs leave each other notes on a payment ("still owes $10, Amy's friend, paying at the door").
 * Comments live in the PaymentNotes tab, linked by order ID (never by row number). Any signed-in exec can add one;
 * the person who wrote it, or an admin, can remove it. Removing only marks it removed: the row stays in the sheet.
 */

const PAYMENT_NOTE_MAX = 1000;       // characters per comment
const PAYMENT_NOTE_PREVIEW = 120;    // characters of the newest comment shown on the payment card

/** The order a comment is for. An archived event's orders live in the archive book, so look there when the page says which event. */
function paymentNoteOrder_(orderId, eventId) {
  const id = String(orderId || "");
  let order = id ? readRows_("Orders").filter(function (o) { return o.id === id; })[0] : null;
  if (!order && id && eventId) {
    const event = findEvent_(function (e) { return e.id === String(eventId); });
    if (event && event.archivedAt) order = eventRows_("Orders", event).filter(function (o) { return o.id === id; })[0] || null;
  }
  if (!order) throw new ApiError_("NOT_FOUND", "That payment isn't there any more.");
  return order;
}

function paymentNoteView_(n) {
  return { id: n.id, orderId: n.orderId, text: String(n.text || "").replace(/^'/, ""), by: n.by, createdAt: n.createdAt };
}

function paymentNoteNewestFirst_(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }

/** The newest comment, cut to one short line for the card. */
function paymentNotePreview_(n) {
  if (!n) return null;
  const text = String(n.text || "").replace(/^'/, "").replace(/\s+/g, " ").trim();
  return { text: text.length > PAYMENT_NOTE_PREVIEW ? text.slice(0, PAYMENT_NOTE_PREVIEW - 1).trim() + "…" : text, by: n.by, createdAt: n.createdAt };
}

/** What the payment card shows for one order's comments (still-showing comments only). */
function paymentNoteSummary_(notes) {
  const showing = notes.filter(function (n) { return !n.removedAt; }).sort(paymentNoteNewestFirst_);
  return { noteCount: showing.length, latestNote: paymentNotePreview_(showing[0]) };
}

/** { orderId: { noteCount, latestNote } } for every order with a comment, from ONE read of the tab. */
function paymentNoteSummaries_() {
  const byOrder = {};
  readRows_("PaymentNotes").forEach(function (n) {
    if (n.removedAt || !n.orderId) return;
    (byOrder[n.orderId] = byOrder[n.orderId] || []).push(n);
  });
  const out = {};
  Object.keys(byOrder).forEach(function (id) { out[id] = paymentNoteSummary_(byOrder[id]); });
  return out;
}

function listPaymentNotes_(orderId) {
  const id = String(orderId || "");
  if (!id) throw new ApiError_("BAD_REQUEST", "Which payment?");
  const notes = readRows_("PaymentNotes").filter(function (n) { return n.orderId === id && !n.removedAt; })
    .sort(paymentNoteNewestFirst_).map(paymentNoteView_);
  return { ok: true, notes: notes, noteCount: notes.length, latestNote: paymentNotePreview_(notes[0]) };
}

/**
 * Exec: add a comment. clientId: the name the page gave this comment, so pressing again after a dropped connection
 * doesn't add it twice. The reply carries the card's new count and newest comment.
 */
function addPaymentNote_(session, orderId, text, clientId, eventId) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  const problem = "Write a comment of up to " + PAYMENT_NOTE_MAX + " characters.";
  if (!raw || raw.length > PAYMENT_NOTE_MAX) throw new ApiError_("BAD_REQUEST", problem);
  const clean = noteText_(raw);
  if (!clean) throw new ApiError_("BAD_REQUEST", problem);
  const named = /^PN[A-Za-z0-9_-]{8,40}$/.test(String(clientId || "")) ? String(clientId) : "";
  return withLock_(function () {
    const order = paymentNoteOrder_(orderId, eventId);
    const added = insertPaymentNoteLocked_(session, order, clean, named);
    if (!added.repeated) log_(session.name, "payment.note", order.code || order.id, { orderId: order.id, noteId: added.note.id });
    return Object.assign({ ok: true }, added);
  });
}

/**
 * Adds one comment to an order. The caller already holds withLock_ and has cleaned the text (noteText_).
 * A clientId that is already there returns that comment (repeated: true) instead of adding a second one.
 * Returns { note, repeated?, noteCount, latestNote }. Does not write the Log: the caller says what happened.
 */
function insertPaymentNoteLocked_(session, order, text, clientId) {
  delete DB_.rows["PaymentNotes"];
  const theirs = readRows_("PaymentNotes").filter(function (n) { return n.orderId === order.id; });
  const before = clientId ? theirs.filter(function (n) { return n.id === clientId; })[0] : null;
  if (before) return Object.assign({ repeated: true, note: paymentNoteView_(before) }, paymentNoteSummary_(theirs));
  const note = { id: clientId || newId_("PN"), orderId: order.id, eventId: order.eventId || "", text: text,
    by: memberText_(session.name, 80), createdAt: new Date().toISOString(), removedAt: "", removedBy: "" };
  insertRow_("PaymentNotes", note);
  return Object.assign({ note: paymentNoteView_(note) }, paymentNoteSummary_(theirs.concat([note])));
}

/** A comment written by mistake: the person who wrote it, or an admin, can remove it. It stays in the sheet, marked removed. */
function removePaymentNote_(session, noteId) {
  const id = String(noteId || "");
  return withLock_(function () {
    delete DB_.rows["PaymentNotes"];
    const rows = readRows_("PaymentNotes");
    const note = id ? rows.filter(function (n) { return n.id === id; })[0] : null;
    if (!note || note.removedAt) throw new ApiError_("NOT_FOUND", "That comment is no longer there.");
    if (session.role !== "admin" && note.by !== memberText_(session.name, 80)) {
      throw new ApiError_("ADMIN_ONLY", "Only " + note.by + " or an admin can remove this comment.");
    }
    const changes = { removedAt: new Date().toISOString(), removedBy: memberText_(session.name, 80) };
    updateRow_("PaymentNotes", note.id, changes, note._row);
    const order = readRows_("Orders").filter(function (o) { return o.id === note.orderId; })[0];
    log_(session.name, "payment.noteRemoved", order ? order.code : note.orderId, { orderId: note.orderId, noteId: note.id });
    const left = rows.filter(function (n) { return n.orderId === note.orderId && n.id !== note.id; });
    return Object.assign({ ok: true, orderId: note.orderId }, paymentNoteSummary_(left));
  });
}
