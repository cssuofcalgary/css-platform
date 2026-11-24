/**
 * CSS Platform API — paying by card through Square (optional).
 *
 * E-transfer stays the normal way to pay. When the Square settings are filled in (Config.js: SQUARE_ACCESS_TOKEN and
 * SQUARE_LOCATION_ID), the ticket page also offers "Pay by card": we ask Square for a one-off checkout page for exactly what
 * is still owed and send the person there. After paying, Square sends them back to their own ticket page
 * (…/ticket.html?t=SECRET&card=1), which asks us to check.
 *
 * We never take the page's, the web address's or the webhook's word about money. We always ask Square itself which payments
 * on that Square order are COMPLETED, in Canadian dollars, and only then record them. Each Square payment is counted once
 * (its id is kept in squarePaymentId), so checking again never adds the same money twice.
 *
 * A card payment that doesn't simply pay off an open order (too little, the order was cancelled, or it was already paid by
 * e-transfer) is recorded as money received but is NOT turned into "paid": it goes to Needs attention for Finance to sort out.
 * A full event doesn't refuse a payment that was already taken: the tickets are confirmed (Activity shows "over capacity").
 *
 * Nothing here runs on a timer. Square is asked when someone presses "Pay by card", comes back from Square, opens their
 * ticket or My tickets, is scanned at the door, or when Square's own notification arrives (public/api/square-webhook.js).
 */

const SQUARE_API_VERSION = "2025-01-23";
const SQUARE_PAID_BY = "Square (Card)";
const SQUARE_CHECK_SECONDS = 15;          // a ticket page, My tickets or a door scan asks Square about one order at most this often
const SQUARE_LINK_REUSE_SECONDS = 1800;   // pressing "Pay by card" again within 30 minutes reopens the same Square page
const SQUARE_MAX_LINKS = 10;              // Square checkout pages one registration can have
const SQUARE_REVIEW_ACTION = "confirmCardPayment";
const CARD_OFF_TEXT = "Card payments aren't available right now. Please pay by e-transfer.";

/** The Square order ids an order has had (newest last). One per checkout page made, so an older page that gets paid is still found. */
function squareOrderIds_(order) {
  return String((order && order.squareOrderId) || "").split(/[\s,]+/).filter(Boolean);
}

/** The Square payments already counted in this order's `received`. */
function squarePaymentIds_(order) {
  return String((order && order.squarePaymentId) || "").split(/[\s,]+/).filter(Boolean);
}

// ---- Talking to Square --------------------------------------------------------------------------

/** One call to Square. Returns the answer as an object, or throws a plain-English ApiError_. The token is never in a message. */
function squareCall_(method, path, body) {
  const cfg = squareConfig_();
  if (!cfg.enabled) throw new ApiError_("CARD_UNAVAILABLE", CARD_OFF_TEXT);
  const options = {
    method: method,
    headers: { Authorization: "Bearer " + cfg.token, "Square-Version": SQUARE_API_VERSION },
    muteHttpExceptions: true
  };
  if (body !== undefined) { options.contentType = "application/json"; options.payload = JSON.stringify(body); }
  let res;
  try {
    res = UrlFetchApp.fetch(cfg.base + path, options);
  } catch (err) {
    squareProblem_(path, "no answer");
    throw new ApiError_("CARD_ERROR", "We couldn't reach the card payment service. Try again in a moment, or pay by e-transfer.");
  }
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText() || "{}") || {}; } catch (e) { data = {}; }
  if (code >= 200 && code < 300) return data;
  const why = (Array.isArray(data.errors) ? data.errors : []).map(function (e) { return String(e.code || e.category || ""); }).filter(Boolean).join(", ");
  squareProblem_(path, code + (why ? " " + why : ""));
  if (code === 401 || code === 403) throw new ApiError_("CARD_UNAVAILABLE", "Card payments aren't working right now. Please pay by e-transfer, or try again later.");
  throw new ApiError_("CARD_ERROR", "The card payment service had a problem. Try again in a moment, or pay by e-transfer.");
}

/** Notes a Square problem for the health check (path and Square's error code only: never the token). */
function squareProblem_(path, what) {
  const text = "Square " + String(path).split("?")[0] + ": " + what;
  console.error(text);
  rememberError_("square", new Error(text));
}

/** The COMPLETED, Canadian-dollar payments on one Square order, asked of Square itself: [{ id, cents }]. */
function squareCompletedPayments_(squareOrderId) {
  const cfg = squareConfig_();
  const sq = squareCall_("get", "/v2/orders/" + encodeURIComponent(squareOrderId)).order || {};
  if (sq.id && sq.id !== squareOrderId) return [];
  if (sq.location_id && sq.location_id !== cfg.locationId) return [];   // not one of the club's
  const ids = [];
  (Array.isArray(sq.tenders) ? sq.tenders : []).forEach(function (t) {
    const id = String(t.payment_id || t.id || "");
    if (id && ids.indexOf(id) === -1) ids.push(id);
  });
  const found = [];
  ids.forEach(function (paymentId) {
    const p = squareCall_("get", "/v2/payments/" + encodeURIComponent(paymentId)).payment || {};
    if (p.status !== "COMPLETED") return;
    if (p.order_id && p.order_id !== squareOrderId) return;
    const money = p.amount_money || {};
    if (money.currency !== "CAD") return;
    const back = p.refunded_money && p.refunded_money.currency === "CAD" ? Math.round(Number(p.refunded_money.amount) || 0) : 0;
    const cents = Math.max(0, Math.round(Number(money.amount) || 0) - back);
    if (cents > 0) found.push({ id: String(p.id || paymentId), cents: cents });
  });
  return found;
}

/** Every completed payment across all of an order's Square checkout pages. */
function squarePaymentsForOrder_(order) {
  const all = [];
  squareOrderIds_(order).forEach(function (sqId) {
    squareCompletedPayments_(sqId).forEach(function (p) {
      if (!all.some(function (x) { return x.id === p.id; })) all.push(p);
    });
  });
  return all;
}

// ---- Recording a card payment ---------------------------------------------------------------------

/**
 * Asks Square about one order's card payments and records any new ones. Call it with NO lock held: Square is asked first,
 * then the locks are taken to write (on data read again inside them). Safe to call any number of times.
 * Returns { paid, already, changed, found }: found = completed payments Square has for this order.
 */
function confirmSquareOrder_(orderId) {
  delete DB_.rows["Orders"];
  const before = readRows_("Orders").filter(function (o) { return o.id === orderId; })[0];
  if (!before) return { paid: false, found: 0 };
  const wasPaid = before.status === "paid";
  if (!squareOrderIds_(before).length) return { paid: wasPaid, already: wasPaid, found: 0 };
  const payments = squarePaymentsForOrder_(before);
  if (!payments.length) return { paid: wasPaid, already: wasPaid, found: 0 };

  const result = withIntakeAndScriptLock_(function () {
    delete DB_.rows["Orders"]; delete DB_.rows["Tickets"]; delete DB_.rows["Events"]; delete DB_.rows["Refunds"];
    const find = function () { return readRows_("Orders").filter(function (o) { return o.id === orderId; })[0]; };
    let order = find();
    if (!order) return { paid: false };
    const counted = squarePaymentIds_(order);
    const fresh = payments.filter(function (p) { return counted.indexOf(p.id) === -1; });
    const freshCents = fresh.reduce(function (sum, p) { return sum + p.cents; }, 0);
    const freshIds = fresh.map(function (p) { return p.id; });
    if (fresh.length) {
      // One write for four side-by-side columns (received, lastWrite, squareOrderId, squarePaymentId are next to each other on
      // new and older sheets alike), so the money and the "already counted" payment ids are saved together, never one alone.
      updateRow_("Orders", order.id, {
        received: String(dollars_(cents_(receivedOf_(order)) + freshCents)),
        lastWrite: "card:" + freshIds.join(","),
        squareOrderId: order.squareOrderId,
        squarePaymentId: counted.concat(freshIds).join(" ")
      }, order._row);
      order = find();
    }
    const amount = dollars_(freshCents);

    if (order.status === "paid") {
      if (fresh.length) noteCardReview_(order, freshIds, amount, "the order was already paid, so this may have been paid twice");
      return { paid: true, already: true, changed: fresh.length > 0 };
    }
    if (order.status !== "awaiting") {
      if (fresh.length) noteCardReview_(order, freshIds, amount, "the order was " + order.status);
      return { paid: false, changed: fresh.length > 0 };
    }
    const due = cents_(order.total) - availableReceivedCents_(order);
    if (due > 0 || !squarePaymentIds_(order).length) {
      if (fresh.length) noteCardReview_(order, freshIds, amount, usd_(dollars_(due)) + " is still owed");
      return { paid: false, changed: fresh.length > 0 };
    }

    // Paid in full. The money is already taken, so a full event can't refuse it: try normally, then go over capacity.
    const finance = { name: SQUARE_PAID_BY };
    let marked;
    try {
      marked = markPaidLocked_(finance, order.id, false, true);
    } catch (err) {
      if (!(err instanceof ApiError_) || err.code !== "OVER_CAPACITY") throw err;
      marked = markPaidLocked_(finance, order.id, true, true);
    }
    log_(SQUARE_PAID_BY, "order.paid.card", order.code, { amount: amount, total: Number(order.total) || 0, tickets: marked.confirmed || 0, payments: freshIds });
    if (due < 0 && fresh.length) noteCardReview_(order, freshIds, amount, usd_(dollars_(-due)) + " more than was owed arrived");
    return { paid: true, changed: true, justPaid: true };
  });
  if (result.justPaid) emailsAfterSave_(orderId);   // after the lock: a slow or failed email never undoes the payment
  result.found = payments.length;
  return result;
}

/**
 * A card payment Finance has to decide about. Written on the order's notes and listed in Needs attention (as a payment to
 * check; "Done" there takes it off the list). Call it while holding the lock.
 */
function noteCardReview_(order, paymentIds, amount, why) {
  const now = new Date().toISOString();
  const text = "Card payment of " + usd_(amount) + " arrived through Square (" + paymentIds.join(", ") + ") but " + why + ". Finance: check it.";
  updateRow_("Orders", order.id, { notes: [order.notes, text].filter(Boolean).join(" | ") }, order._row);
  const id = SQUARE_REVIEW_ACTION + ":" + order.id + ":" + paymentIds[0];
  if (!savedRequestRow_(id)) {
    insertRow_("Requests", {
      id: id, action: SQUARE_REVIEW_ACTION, who: SQUARE_PAID_BY, status: "done", plan: {},
      reply: { ok: false, error: "NEEDS_REVIEW", conflicts: [order.id], alreadySaved: [], message: text },
      createdAt: now, doneAt: now
    });
  }
  log_(SQUARE_PAID_BY, "order.card.review", order.code, { amount: amount, why: why, payments: paymentIds });
}

/** Should a page or a scan ask Square about this order now? Unpaid, has a Square page, card payments on, not asked in the last 15 s. */
function squareCheckDue_(order) {
  if (!order || order.status !== "awaiting" || !squareOrderIds_(order).length || !cardEnabled_()) return false;
  try { return !CacheService.getScriptCache().get("sqchk_" + order.id); } catch (e) { return false; }
}

/**
 * The ticket page, My tickets and the door call this for an unpaid order that has a Square checkout page, so a card payment
 * whose "back to the ticket" step never happened still shows as paid. At most once every 15 s per order. Never throws:
 * Square being down must never break a ticket page or a door scan. True when something was recorded (read the order again).
 * Call it with NO lock held.
 */
function reconcileSquareOrderIfPending_(order) {
  try {
    if (!squareCheckDue_(order)) return false;
    CacheService.getScriptCache().put("sqchk_" + order.id, "1", SQUARE_CHECK_SECONDS);
    return !!confirmSquareOrder_(order.id).changed;
  } catch (err) {
    console.error("Square check skipped: " + (err && err.message || err));
    return false;
  }
}

// ---- Public actions ---------------------------------------------------------------------------------

/** A ticket and its order by the ticket's secret (the only key a public card action accepts), read fresh. */
function cardTicket_(secret) {
  const key = String(secret || "").trim();
  if (key.length < 20) throw new ApiError_("NOT_FOUND", "Ticket not found.");
  delete DB_.rows["Tickets"]; delete DB_.rows["Orders"];
  const ticket = readRows_("Tickets").filter(function (t) { return t.secret === key; })[0];
  if (!ticket) throw new ApiError_("NOT_FOUND", "Ticket not found.");
  const order = readRows_("Orders").filter(function (o) { return o.id === ticket.orderId; })[0];
  if (!order) throw new ApiError_("NOT_FOUND", "Order not found.");
  return { ticket: ticket, order: order };
}

/**
 * Where Square sends the person after paying: their own ticket page on the events site. A `siteUrl` from the page is used only
 * when it is one of the allowed events-site addresses (the same list as ticket emails); otherwise the remembered or default one.
 */
function cardReturnUrl_(secret, siteUrl) {
  const given = String(siteUrl || "").trim();
  const stored = PropertiesService.getScriptProperties().getProperty("PUBLIC_SITE_URL");
  const base = allowedSiteUrl_(given) ? given.replace(/\/?$/, "/")
    : allowedSiteUrl_(stored) ? String(stored).trim().replace(/\/?$/, "/")
    : SITE_URL_DEFAULT;
  return base + "ticket.html?t=" + encodeURIComponent(secret) + "&card=1";
}

/**
 * Public, from the ticket page: "Pay by card". Returns { ok, url } (Square's checkout page for what is still owed) or
 * { ok, alreadyPaid: true }. The order is found by the ticket's secret, never by an order id.
 */
function createCardCheckout_(req) {
  if (!cardEnabled_()) throw new ApiError_("CARD_UNAVAILABLE", CARD_OFF_TEXT);
  const first = cardTicket_(req.secret);
  if (first.order.status === "paid") return { ok: true, alreadyPaid: true };

  // An earlier Square page may have been paid already (they closed the tab before coming back): ask Square before making another.
  let reusable = true;
  if (first.order.status === "awaiting" && squareOrderIds_(first.order).length) {
    const check = confirmSquareOrder_(first.order.id);
    if (check.paid) return { ok: true, alreadyPaid: true };
    reusable = !check.found;
  }

  // Decide on fresh data, inside the lock: the order still open, something still owed, and room at the event.
  const plan = withLock_(function () {
    const now = cardTicket_(req.secret);
    const ticket = now.ticket, order = now.order;
    if (order.status === "paid") return { alreadyPaid: true };
    if (order.status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This registration was " + order.status + ", so it can't be paid. Please contact us.");
    if (ticket.status !== "awaiting" && ticket.status !== "paid") throw new ApiError_("BAD_REQUEST", "This ticket was " + ticket.status + ", so it can't be paid. Please contact us.");
    delete DB_.rows["Events"];
    const event = findEvent_(function (e) { return e.id === order.eventId; });
    if (!event) throw new ApiError_("NOT_FOUND", "Event not found.");
    if (event.archivedAt || event.status === "archived") throw new ApiError_("BAD_REQUEST", "This event is archived, so it can't be paid. Please contact us.");
    if (event.date && event.date < todayEdmonton_()) throw new ApiError_("BAD_REQUEST", "This event is over, so it can't be paid. Please contact us.");
    const due = cents_(order.total) - availableReceivedCents_(order);
    if (due <= 0) throw new ApiError_("BAD_REQUEST", "There's nothing left to pay on this registration. If it still says unpaid, please contact us.");
    if (event.capacity && event.capacityRule === "paid") {
      const mine = readRows_("Tickets").filter(function (t) { return t.orderId === order.id && t.status === "awaiting"; }).length;
      if (spotsTaken_(event) + mine > Number(event.capacity)) throw new ApiError_("SOLD_OUT", "This event is full, so this registration can't be paid now. Please contact us.");
    }
    return { order: order, ticket: ticket, event: event, due: due };
  });
  if (plan.alreadyPaid) return { ok: true, alreadyPaid: true };

  const order = plan.order;
  const ids = squareOrderIds_(order);
  const cache = CacheService.getScriptCache();
  let saved = null;
  try { saved = JSON.parse(cache.get("sqlink_" + order.id) || "null"); } catch (e) { saved = null; }
  if (reusable && saved && saved.sq === ids[ids.length - 1] && saved.cents === plan.due && saved.url) return { ok: true, url: saved.url };
  if (ids.length >= SQUARE_MAX_LINKS) throw new ApiError_("TOO_MANY_TRIES", "Too many card payment tries for this registration. Please pay by e-transfer, or contact us.");

  // Ask Square for the checkout page (no lock held while waiting for Square).
  const cfg = squareConfig_();
  const email = String(order.payerEmail || "").trim();
  const body = {
    idempotency_key: Utilities.getUuid(),
    quick_pay: {
      name: ("CSS — " + plan.event.name + " (" + order.code + ")").slice(0, 255),
      price_money: { amount: plan.due, currency: "CAD" },
      location_id: cfg.locationId
    },
    checkout_options: { redirect_url: cardReturnUrl_(plan.ticket.secret, req.siteUrl) }
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.pre_populated_data = { buyer_email: email };
  const link = squareCall_("post", "/v2/online-checkout/payment-links", body).payment_link || {};
  if (!link.url || !link.order_id) {
    squareProblem_("/v2/online-checkout/payment-links", "no checkout page in the answer");
    throw new ApiError_("CARD_ERROR", "The card payment service had a problem. Try again in a moment, or pay by e-transfer.");
  }

  // Keep the Square order id (even if the order changed meanwhile), so a payment on this page can always be found.
  const status = withLock_(function () {
    delete DB_.rows["Orders"];
    const row = readRows_("Orders").filter(function (o) { return o.id === order.id; })[0];
    if (!row) throw new ApiError_("NOT_FOUND", "Order not found.");
    const list = squareOrderIds_(row);
    if (list.indexOf(link.order_id) === -1) list.push(link.order_id);
    updateRow_("Orders", row.id, { squareOrderId: list.join(" ") }, row._row);   // on its own, never with lastWrite in a plan
    return row.status;
  });
  if (status === "paid") return { ok: true, alreadyPaid: true };
  if (status !== "awaiting") throw new ApiError_("BAD_REQUEST", "This registration was " + status + ", so it can't be paid. Please contact us.");
  try { cache.put("sqlink_" + order.id, JSON.stringify({ sq: link.order_id, cents: plan.due, url: link.url }), SQUARE_LINK_REUSE_SECONDS); } catch (e) { /* a new page next time */ }
  return { ok: true, url: link.url };
}

/**
 * Public, from the ticket page after Square sends the person back: "did my card payment go through?" Always asks Square
 * (no 15 s wait). The Square order comes from our own sheet, never from the web address. Returns { ok, paid, alreadyPaid? }.
 */
function confirmCardPayment_(req) {
  const order = cardTicket_(req.secret).order;
  if (order.status === "paid") return { ok: true, paid: true, alreadyPaid: true };
  if (!squareOrderIds_(order).length || !cardEnabled_()) return { ok: true, paid: false };
  try { CacheService.getScriptCache().put("sqchk_" + order.id, "1", SQUARE_CHECK_SECONDS); } catch (e) { /* fine */ }
  const r = confirmSquareOrder_(order.id);
  if (!r.paid) return { ok: true, paid: false };
  return r.already ? { ok: true, paid: true, alreadyPaid: true } : { ok: true, paid: true };
}

/**
 * Public, from the events site's Square notification relay (public/api/square-webhook.js): "Square says this order was paid".
 * Only a hint: the order is checked with Square itself before anything is recorded. Unknown orders are ignored.
 */
function confirmSquareWebhook_(req) {
  const sqId = String(req.squareOrderId || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(sqId)) throw new ApiError_("BAD_REQUEST", "Which Square order?");
  if (!cardEnabled_()) return { ok: true, ignored: true };
  const order = readRows_("Orders").filter(function (o) { return squareOrderIds_(o).indexOf(sqId) !== -1; })[0];
  if (!order) return { ok: true, ignored: true };
  const r = confirmSquareOrder_(order.id);
  return { ok: true, paid: !!r.paid };
}
