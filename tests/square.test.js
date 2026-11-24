// Card payments through Square (api/Square.js + public/api/square-webhook.js), with a fake Square: no network, no real keys,
// no real email. Covers making the checkout page, confirming the payment, already paid, a full event, backing out, the ticket
// page / My tickets / door noticing a card payment by themselves, the webhook relay, Square switched off, and odd payments for Finance.
const { run, fetchStub, store, cache } = require("./harness.js");
const crypto = require("crypto");
const { Readable } = require("stream");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { ok: true, v: run(code) }; } catch (e) { return { error: e.code || String(e), message: e.message }; } };

const TOKEN = "sq-SECRET-token-do-not-leak-123";
const squareOn = () => { store.SQUARE_ACCESS_TOKEN = TOKEN; store.SQUARE_LOCATION_ID = "LOC1"; store.SQUARE_ENV = "sandbox"; store.SQUARE_PASS_FEE = "false"; };
const squareOff = () => { delete store.SQUARE_ACCESS_TOKEN; delete store.SQUARE_LOCATION_ID; delete store.SQUARE_ENV; delete store.SQUARE_PASS_FEE; delete store.SQUARE_FEE_PERCENT; delete store.SQUARE_FEE_FIXED; };
const replies = [];   // every reply a page got, checked for the token at the end
const call = (code) => { const r = fn(code); replies.push(r); return r; };

// ---- A fake Square ----------------------------------------------------------------------------------
const sq = { orders: {}, payments: {}, n: 0, down: false, lastLink: null };
const sqCalls = (re) => fetchStub.calls.filter((c) => re.test(c.url)).length;
fetchStub.handler = (url, opts) => {
  if (sq.down) return { throws: "Address unavailable" };
  if (!url.startsWith("https://connect.squareupsandbox.com/")) return { code: 500, body: { errors: [{ code: "WRONG_HOST" }] } };
  if (opts.headers.Authorization !== "Bearer " + TOKEN || !opts.headers["Square-Version"]) return { code: 401, body: { errors: [{ code: "UNAUTHORIZED" }] } };
  if (/\/v2\/online-checkout\/payment-links$/.test(url) && opts.method === "post") {
    const body = JSON.parse(opts.payload);
    sq.lastLink = body;
    const id = "SQORD" + String(++sq.n).padStart(4, "0");
    const locId = body.quick_pay ? body.quick_pay.location_id : (body.order && body.order.location_id);
    const items = body.order && Array.isArray(body.order.line_items) ? body.order.line_items : [];
    sq.orders[id] = { id: id, location_id: locId, state: "OPEN", line_items: items, tenders: [] };
    return { code: 200, body: { payment_link: { id: "PL" + sq.n, url: "https://sandbox.square.link/u/" + id, order_id: id } } };
  }
  let m = /\/v2\/orders\/([^/?]+)$/.exec(url);
  if (m && opts.method === "get") return sq.orders[m[1]] ? { code: 200, body: { order: sq.orders[m[1]] } } : { code: 404, body: { errors: [{ code: "NOT_FOUND" }] } };
  m = /\/v2\/payments\/([^/?]+)$/.exec(url);
  if (m && opts.method === "get") return sq.payments[m[1]] ? { code: 200, body: { payment: sq.payments[m[1]] } } : { code: 404, body: { errors: [{ code: "NOT_FOUND" }] } };
  return { code: 400, body: { errors: [{ code: "BAD_REQUEST" }] } };
};
let payN = 0;
function pay(sqOrderId, cents, extra) {
  const id = "PAY" + String(++payN).padStart(4, "0");
  sq.payments[id] = Object.assign({ id: id, status: "COMPLETED", order_id: sqOrderId, amount_money: { amount: cents, currency: "CAD" } }, extra || {});
  sq.orders[sqOrderId].tenders.push({ id: id, type: "CARD", payment_id: id, amount_money: { amount: cents, currency: "CAD" } });
  return id;
}

run(`
function ev(id, extra) {
  return Object.assign({ id:id, slug:id.toLowerCase(), name:"Event " + id, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
    status:"published", entryOpen:"TRUE", ticketTypes:[{ id:"TG", name:"General", price:12.5 }], questions:[], codePrefix:"EV", archivedAt:"", summary:{}, updatedAt:"2026-10-01T00:00:00Z" }, extra || {});
}
TBL.Events = [ev("EV1"), ev("EVC", { capacity:2 }), ev("EVOLD", { date:"2001-01-01" })];
TBL.Orders = []; TBL.Tickets = []; TBL.Refunds = []; TBL.Requests = [];
function table_() {}
function throttle_() {}
function findTicketFresh_(kind, value) { return TBL.Tickets.filter(function (t) { return (kind === "secret" ? t.secret : t.id) === value; })[0] || null; }
var __tix = [], __log = [];
function sendTicketEmail_(event, t) { __tix.push(t.id); return true; }
function log_(who, action, target, details) { __log.push({ who: who, action: action, target: target, details: details || {} }); }
var __errors = [];
function rememberError_(action, err) { __errors.push(String(action) + ": " + String(err && err.message || err)); }   // what the health check would show
var S = { name: "Fin Exec", role: "exec" };
var DOOR = { name: "Vol", role: "door", sid: "sid-door-1" };
function ord(id, eventId, status, total, extra) { insertRow_("Orders", Object.assign({ id:id, code:"EV-" + id, eventId:eventId, payerName:"Payer " + id, payerEmail:id.toLowerCase() + "@x.ca", etransferName:"", total:total, status:status, createdAt:"2026-10-01T00:00:00Z", paidAt:"", paidBy:"", notes:"", remindedAt:"", cancelRequestedAt:"", received:"", squareOrderId:"", squarePaymentId:"", lastWrite:"" }, extra || {})); }
function tk(id, orderId, eventId, status, price, extra) { insertRow_("Tickets", Object.assign({ id:id, secret:(id + "0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:eventId, name:"N" + id, email:id.toLowerCase() + "@x.ca", ucid:"", memberId:"", ticketType:"General", price:price, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt: status === "paid" ? "sent" : "" }, extra || {})); }
function order(id) { return TBL.Orders.filter(function (o) { return o.id === id; })[0]; }
function ticket(id) { return TBL.Tickets.filter(function (t) { return t.id === id; })[0]; }
function sec(id) { return ticket(id).secret; }
`);
const secret = (id) => run(`sec("${id}")`);
const order = (id) => run(`order("${id}")`);
const ticket = (id) => run(`ticket("${id}")`);
const create = (id, siteUrl) => call(`createCardCheckout_({ secret: sec("${id}")${siteUrl ? ", siteUrl: " + JSON.stringify(siteUrl) : ""} })`);
const confirm = (id) => call(`confirmCardPayment_({ secret: sec("${id}") })`);
const forget = (orderId) => { delete cache["sqchk_" + orderId]; };
const logOf = (action, target) => run(`__log.filter(function (l) { return l.action === "${action}" && l.target === "${target}"; })`);

squareOn();

// ================= 1. Making the checkout page =================
run(`ord("A1", "EV1", "awaiting", 25); tk("TKTA1A", "A1", "EV1", "awaiting", 12.5); tk("TKTA1B", "A1", "EV1", "awaiting", 12.5);`);
let r = create("TKTA1A", "https://events.ucalgarycss.ca");
ok(r.ok && r.v.ok && r.v.url === "https://sandbox.square.link/u/SQORD0001", "Pay by card returns Square's checkout page: " + JSON.stringify(r.v));
ok(sq.lastLink.quick_pay.price_money.amount === 2500 && sq.lastLink.quick_pay.price_money.currency === "CAD", "the amount is what is owed, in cents, in Canadian dollars");
ok(sq.lastLink.quick_pay.location_id === "LOC1" && /EV-A1/.test(sq.lastLink.quick_pay.name) && /Event EV1/.test(sq.lastLink.quick_pay.name), "the club's location, with the event and payment code in the name: " + sq.lastLink.quick_pay.name);
ok(sq.lastLink.checkout_options.redirect_url === "https://events.ucalgarycss.ca/ticket.html?t=" + secret("TKTA1A") + "&card=1", "Square sends them back to their own ticket page with &card=1");
ok(sq.lastLink.pre_populated_data.buyer_email === "a1@x.ca" && typeof sq.lastLink.idempotency_key === "string" && sq.lastLink.idempotency_key.length > 10, "the payer's email is filled in and every request has its own idempotency key");
const post = fetchStub.calls.filter((c) => /payment-links$/.test(c.url))[0];
ok(post.opts.method === "post" && post.opts.contentType === "application/json" && post.opts.muteHttpExceptions === true && post.opts.headers["Square-Version"] === "2025-01-23", "the request is a JSON POST to the sandbox with the Square version header");
ok(order("A1").squareOrderId === "SQORD0001" && order("A1").status === "awaiting" && order("A1").lastWrite === "", "the Square order id is kept on the order (on its own, lastWrite untouched); nothing is paid yet");

const posts = () => sqCalls(/payment-links$/);
let before = posts();
r = create("TKTA1B", "https://events.ucalgarycss.ca/");
ok(r.v.url === "https://sandbox.square.link/u/SQORD0001" && posts() === before, "pressing Pay by card again (any ticket of the group) reopens the same Square page");

run(`ord("A2", "EV1", "awaiting", 30, { received: "10" }); tk("TKTA2A", "A2", "EV1", "awaiting", 30);`);
r = create("TKTA2A", "https://evil.example.com");
ok(r.v.url && sq.lastLink.quick_pay.price_money.amount === 2000, "part already received ($10 of $30): the page asks for the $20 left");
ok(sq.lastLink.checkout_options.redirect_url === "https://events.ucalgarycss.ca/ticket.html?t=" + secret("TKTA2A") + "&card=1", "an unknown siteUrl is ignored: back to the real events site");
store.PUBLIC_SITE_URL = "https://css-platform-public.vercel.app/";
run(`ord("A3", "EV1", "awaiting", 12.5); tk("TKTA3A", "A3", "EV1", "awaiting", 12.5);`);
create("TKTA3A", "javascript:alert(1)");
ok(sq.lastLink.checkout_options.redirect_url === "https://css-platform-public.vercel.app/ticket.html?t=" + secret("TKTA3A") + "&card=1", "with no usable siteUrl, the remembered events-site address is used");
delete store.PUBLIC_SITE_URL;

// capacity is checked before sending anyone to Square
run(`ord("C0", "EVC", "paid", 25); tk("TKTC0A", "C0", "EVC", "paid", 12.5); tk("TKTC0B", "C0", "EVC", "paid", 12.5);
     ord("C1", "EVC", "awaiting", 12.5); tk("TKTC1A", "C1", "EVC", "awaiting", 12.5);`);
before = posts();
r = create("TKTC1A");
ok(r.error === "SOLD_OUT" && posts() === before && !order("C1").squareOrderId, "a full event: SOLD_OUT before any Square page is made");

// refused orders
run(`ord("X0", "EV1", "cancelled", 0); tk("TKTX0A", "X0", "EV1", "cancelled", 12.5);
     ord("R0", "EV1", "refunded", 0); tk("TKTR0A", "R0", "EV1", "refunded", 12.5);
     ord("Z0", "EV1", "awaiting", 0, { notes: "Requires exec verification of member status" }); tk("TKTZ0A", "Z0", "EV1", "awaiting", 0);
     ord("O0", "EVOLD", "awaiting", 12.5); tk("TKTO0A", "O0", "EVOLD", "awaiting", 12.5);`);
before = posts();
ok(create("TKTX0A").error === "BAD_REQUEST" && create("TKTR0A").error === "BAD_REQUEST", "cancelled and refunded orders are refused");
ok(create("TKTZ0A").error === "BAD_REQUEST", "nothing owed ($0 waiting for a check): refused");
ok(create("TKTO0A").error === "BAD_REQUEST", "an event that is over: refused");
ok(call(`createCardCheckout_({ secret: "short" })`).error === "NOT_FOUND" && call(`createCardCheckout_({ secret: "${"f".repeat(32)}" })`).error === "NOT_FOUND", "a bad or unknown ticket secret: NOT_FOUND");
ok(call(`createCardCheckout_({ orderId: "A1" })`).error === "NOT_FOUND", "an order id alone is never enough");
ok(posts() === before, "no Square page was made for any refused order");

// ================= 2. Coming back from Square: confirm =================
const p1 = pay("SQORD0001", 2500);
run(`__tix.length = 0;`);
r = confirm("TKTA1A");
ok(r.v && r.v.ok && r.v.paid === true && !r.v.alreadyPaid, "after paying, the ticket page's check says paid: " + JSON.stringify(r.v));
let o = order("A1");
ok(o.status === "paid" && o.paidBy === "Square (Card)" && o.squarePaymentId === p1 && o.received === "25", "the order is paid by Square (Card), the payment id is kept and $25 is recorded as received");
ok(ticket("TKTA1A").status === "paid" && ticket("TKTA1B").status === "paid", "every ticket in the group is paid");
ok(run("__tix.slice().sort().join()") === "TKTA1A,TKTA1B", "both people get their ticket email (fake mailer)");
ok(logOf("order.paid.card", "EV-A1").length === 1 && logOf("order.paid", "EV-A1")[0].details.overCapacity === false, "Activity: a card payment line, and the paid line is not 'over capacity'");
r = confirm("TKTA1B");
ok(r.v.paid === true && r.v.alreadyPaid === true && order("A1").received === "25" && run("__tix.length") === 2, "checking again: already paid, nothing counted twice, no more emails");
const gets = sqCalls(/\/v2\/orders\//);
r = call(`confirmSquareWebhook_({ squareOrderId: "SQORD0001" })`);
ok(r.v.paid === true && order("A1").received === "25" && order("A1").squarePaymentId === p1 && sqCalls(/\/v2\/orders\//) > gets, "Square's notification afterwards is checked with Square and changes nothing");

// an existing Square page that was already paid: Pay by card says so instead of making another page
const sqA2 = order("A2").squareOrderId;
pay(sqA2, 2000);
before = posts();
r = create("TKTA2A");
ok(r.v && r.v.alreadyPaid === true && posts() === before && order("A2").status === "paid" && order("A2").received === "30", "the earlier Square page was paid: alreadyPaid, the order is confirmed with $30 received, no new page");

// ================= 3. Already paid by e-transfer =================
run(`ord("E1", "EV1", "awaiting", 12.5); tk("TKTE1A", "E1", "EV1", "awaiting", 12.5); markOrderPaid_(S, "E1");`);
before = fetchStub.calls.length;
r = create("TKTE1A");
ok(r.v && r.v.ok && r.v.alreadyPaid === true && fetchStub.calls.length === before, "paid by e-transfer: Pay by card answers alreadyPaid without calling Square");
r = confirm("TKTE1A");
ok(r.v.paid === true && r.v.alreadyPaid === true && fetchStub.calls.length === before, "and the confirm check says paid without calling Square");

// ================= 4. The event filled up while the buyer was on Square =================
run(`ord("F1", "EVC", "awaiting", 12.5); tk("TKTF1A", "F1", "EVC", "awaiting", 12.5);
     TBL.Tickets.filter(function (t) { return t.id === "TKTC0B"; })[0].status = "cancelled";`);
r = create("TKTF1A");
ok(r.v && r.v.url, "one spot left: the Square page is made");
run(`ord("F2", "EVC", "paid", 12.5); tk("TKTF2A", "F2", "EVC", "paid", 12.5);`);   // someone else takes the last spot meanwhile
pay(order("F1").squareOrderId, 1250);
r = confirm("TKTF1A");
ok(r.v.paid === true && order("F1").status === "paid" && ticket("TKTF1A").status === "paid", "the money was taken, so the payment is honoured even though the event is now full");
ok(logOf("order.paid", "EV-F1")[0].details.overCapacity === true, "and Activity shows it went over capacity");

// ================= 5. Backing out of Square =================
run(`ord("B1", "EV1", "awaiting", 12.5); tk("TKTB1A", "B1", "EV1", "awaiting", 12.5);`);
create("TKTB1A");
r = confirm("TKTB1A");
ok(r.v.ok && r.v.paid === false && order("B1").status === "awaiting" && !order("B1").squarePaymentId, "came back without paying: still waiting for payment, nothing recorded");
ok(run(`getTicket_(sec("TKTB1A")).ticket.status`) === "awaiting", "the ticket page still shows unpaid");
r = call(`markOrderPaid_(S, "B1")`);
ok(r.v && r.v.ok && order("B1").status === "paid" && order("B1").paidBy === "Fin Exec", "Finance can still mark it paid when the e-transfer arrives");

// ================= 6. Noticing a card payment without the "back to the ticket" step =================
run(`ord("H1", "EV1", "awaiting", 12.5); tk("TKTH1A", "H1", "EV1", "awaiting", 12.5);`);
create("TKTH1A");
forget("H1");
pay(order("H1").squareOrderId, 1250);
let t = call(`getTicket_(sec("TKTH1A"))`).v;
ok(t.ticket.status === "paid" && order("H1").status === "paid" && order("H1").paidBy === "Square (Card)", "opening the ticket page asks Square and shows the card payment as paid");

run(`ord("H2", "EV1", "awaiting", 12.5); tk("TKTH2A", "H2", "EV1", "awaiting", 12.5);`);
create("TKTH2A");
forget("H2");
before = sqCalls(/\/v2\/orders\//);
t = call(`getTicket_(sec("TKTH2A"))`).v;
ok(t.ticket.status === "awaiting" && sqCalls(/\/v2\/orders\//) === before + 1, "unpaid: the ticket page asked Square once and still shows unpaid");
pay(order("H2").squareOrderId, 1250);
t = call(`getTicket_(sec("TKTH2A"))`).v;
ok(t.ticket.status === "awaiting" && sqCalls(/\/v2\/orders\//) === before + 1, "opened again within 15 seconds: Square is not asked again");
forget("H2");
t = call(`getTicket_(sec("TKTH2A"))`).v;
ok(t.ticket.status === "paid" && t.orderReceived === 0, "15 seconds later: asked again, now paid");

// door: a card payment lets the person in green
run(`ord("D1", "EV1", "awaiting", 12.5); tk("TKTD1A", "D1", "EV1", "awaiting", 12.5);`);
create("TKTD1A");
forget("D1");
pay(order("D1").squareOrderId, 1250);
r = call(`REQ_SCANNER_ = true; scan_(DOOR, "EV1", "https://events.ucalgarycss.ca/ticket.html?t=" + sec("TKTD1A"), false)`);
ok(r.v.result.color === "green" && ticket("TKTD1A").checkedInAt && order("D1").status === "paid", "a door scan asks Square, records the card payment and checks the person in (green)");

// door + My tickets: Square down never breaks anything
run(`ord("D2", "EV1", "awaiting", 12.5); tk("TKTD2A", "D2", "EV1", "awaiting", 12.5);`);
create("TKTD2A");
forget("D2");
sq.down = true;
r = call(`scan_(DOOR, "EV1", "https://events.ucalgarycss.ca/ticket.html?t=" + sec("TKTD2A"), false)`);
ok(r.v && r.v.result.color === "orange" && !ticket("TKTD2A").checkedInAt, "Square down: the scan still answers (unpaid, help desk)");
forget("D2");
t = call(`getTicket_(sec("TKTD2A"))`);
ok(t.v && t.v.ok && t.v.ticket.status === "awaiting", "Square down: the ticket page still opens");
sq.down = false;
forget("D2");
pay(order("D2").squareOrderId, 1250);
const tixKey = run(`linkKey_("tix", "tktd2a@x.ca")`);
r = call(`myTickets_({ email: "tktd2a@x.ca", k: "${tixKey}" })`);
ok(r.v && r.v.tickets.length === 1 && r.v.tickets[0].status === "paid" && order("D2").status === "paid", "My tickets also notices the card payment and shows it paid");

// ================= 7. The Square notification relay =================
run(`ord("W1", "EV1", "awaiting", 12.5); tk("TKTW1A", "W1", "EV1", "awaiting", 12.5);`);
create("TKTW1A");
const sqW1 = order("W1").squareOrderId;
r = call(`route_({ action: "confirmSquareWebhook", squareOrderId: "${sqW1}" })`);
ok(r.v && r.v.ok && r.v.paid === false && order("W1").status === "awaiting", "a notification for an order Square shows unpaid records nothing");
pay(sqW1, 1250);
r = call(`route_({ action: "confirmSquareWebhook", squareOrderId: "${sqW1}" })`);
ok(r.v && r.v.paid === true && order("W1").status === "paid", "the route checks with Square and records the payment");
ok(call(`route_({ action: "confirmSquareWebhook", squareOrderId: "SQUNKNOWN99" })`).v.ignored === true, "an unknown Square order is ignored");
ok(call(`route_({ action: "confirmSquareWebhook", squareOrderId: "bad id!" })`).error === "BAD_REQUEST", "a malformed id is refused");
ok(call(`route_({ action: "createCardCheckout", secret: sec("TKTB1A") })`).v.alreadyPaid === true && call(`route_({ action: "confirmCardPayment", secret: sec("TKTB1A") })`).v.paid === true, "createCardCheckout and confirmCardPayment are routed as public actions (no sign-in)");

const hook = require("../public/api/square-webhook.js");
const KEY = "test-signature-key", URL_ = "https://events.example.test/api/square-webhook", API = "https://script.example.test/exec";
const sign = (body, key) => crypto.createHmac("sha256", key || KEY).update(URL_ + body).digest("base64");
const event = (type, status, orderId) => JSON.stringify({ type: type, data: { object: { payment: { id: "PAYX", status: status, order_id: orderId } } } });
ok(hook.verifySignature("{}", sign("{}"), KEY, URL_) === true, "a correct Square signature is accepted");
ok(hook.verifySignature("{}", sign("{}", "wrong-key"), KEY, URL_) === false && hook.verifySignature("{}", "short", KEY, URL_) === false && hook.verifySignature("{}", "", KEY, URL_) === false, "wrong key, wrong length or missing signature: rejected");
ok(hook.verifySignature("{}", sign("{}"), "", URL_) === false, "no signature key configured: everything is rejected");
ok(typeof hook === "function" && hook.config && hook.config.api.bodyParser === false, "Vercel handler, with body parsing off so the raw body can be checked");

function fakeReq(body, headers) { const req = Readable.from([Buffer.from(body)]); req.method = "POST"; req.headers = headers || {}; return req; }
function fakeRes() { return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ""; } }; }
(async () => {
  const forwarded = [];
  const fakeFetch = async (url, opts) => { forwarded.push({ url, opts }); return { ok: true, json: async () => ({ ok: true, paid: true }) }; };
  const handler = hook.makeHandler({ fetch: fakeFetch, env: { SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_URL: URL_, API_URL: API } });

  let body = event("payment.updated", "COMPLETED", "SQORD0042");
  let res = fakeRes();
  await handler(fakeReq(body, { "x-square-hmacsha256-signature": sign(body, "forged") }), res);
  ok(res.statusCode === 401 && forwarded.length === 0, "a forged signature gets 401 and nothing is forwarded");
  res = fakeRes();
  await handler(fakeReq(body, {}), res);
  ok(res.statusCode === 401 && forwarded.length === 0, "a missing signature gets 401");
  res = fakeRes();
  await handler(fakeReq(body, { "x-square-hmacsha256-signature": sign(body) }), res);
  const sentBody = forwarded[0] && JSON.parse(forwarded[0].opts.body);
  ok(res.statusCode === 200 && forwarded.length === 1 && forwarded[0].url === API && forwarded[0].opts.method === "POST" && forwarded[0].opts.redirect === "follow", "a real completed payment is forwarded to the API (following Apps Script's redirect)");
  ok(sentBody && sentBody.action === "confirmSquareWebhook" && sentBody.squareOrderId === "SQORD0042" && Object.keys(sentBody).length === 2, "only the action and the Square order id are sent on");
  body = event("payment.updated", "APPROVED", "SQORD0042");
  res = fakeRes();
  await handler(fakeReq(body, { "x-square-hmacsha256-signature": sign(body) }), res);
  ok(res.statusCode === 200 && forwarded.length === 1, "a payment that isn't completed yet: 200, nothing forwarded");
  body = JSON.stringify({ type: "order.created", data: {} });
  res = fakeRes();
  await handler(fakeReq(body, { "x-square-hmacsha256-signature": sign(body) }), res);
  ok(res.statusCode === 200 && forwarded.length === 1, "another kind of event: 200, nothing forwarded");
  const busy = hook.makeHandler({ fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: "BUSY" }) }), env: { SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_URL: URL_, API_URL: API } });
  body = event("payment.updated", "COMPLETED", "SQORD0042");
  res = fakeRes();
  await busy(fakeReq(body, { "x-square-hmacsha256-signature": sign(body) }), res);
  ok(res.statusCode === 502, "the API was busy: a non-200 so Square sends the notification again later");
  const hung = hook.makeHandler({
    timeoutMs: 25,
    fetch: (_u, opts) => new Promise((_resolve, reject) => { opts.signal.addEventListener("abort", () => reject(new Error("aborted"))); }),
    env: { SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_URL: URL_, API_URL: API }
  });
  res = fakeRes();
  await hung(fakeReq(body, { "x-square-hmacsha256-signature": sign(body) }), res);
  ok(res.statusCode === 502, "a hung API call is aborted before Square's 10s deadline and returns 502 for retry");
  res = fakeRes();
  const get = fakeReq("", {}); get.method = "GET";
  await handler(get, res);
  ok(res.statusCode === 405, "only POST is accepted");

  // end-to-end: the relay's forwarded request goes through the real route_ in the test API
  run(`ord("W2", "EV1", "awaiting", 12.5); tk("TKTW2A", "W2", "EV1", "awaiting", 12.5);`);
  create("TKTW2A");
  const sqW2 = order("W2").squareOrderId;
  pay(sqW2, 1250);
  const toApi = hook.makeHandler({
    fetch: async (url, opts) => { const reply = run(`route_(${opts.body})`); return { ok: true, json: async () => JSON.parse(JSON.stringify(reply)) }; },
    env: { SQUARE_WEBHOOK_SIGNATURE_KEY: KEY, SQUARE_WEBHOOK_URL: URL_, API_URL: API }
  });
  body = event("payment.updated", "COMPLETED", sqW2);
  res = fakeRes();
  await toApi(fakeReq(body, { "x-square-hmacsha256-signature": sign(body) }), res);
  ok(res.statusCode === 200 && order("W2").status === "paid" && order("W2").paidBy === "Square (Card)", "end to end: Square's notification → relay → API → checked with Square → paid");

  rest();
})().catch((e) => { console.log("FAIL webhook tests threw: " + (e && e.stack || e)); fails++; rest(); });

function rest() {
  // ================= Odd card payments go to Finance =================
  // too little
  run(`ord("S1", "EV1", "awaiting", 25); tk("TKTS1A", "S1", "EV1", "awaiting", 25);`);
  create("TKTS1A");
  const pShort = pay(order("S1").squareOrderId, 1000);
  r = confirm("TKTS1A");
  o = order("S1");
  ok(r.v.paid === false && o.status === "awaiting" && o.received === "10" && o.squarePaymentId === pShort, "a short card payment: recorded as $10 received, NOT marked paid");
  ok(/Card payment of \$10/.test(o.notes) && /\$15 is still owed/.test(o.notes), "the order's notes say what arrived and what is still owed: " + o.notes);
  let attn = run("attentionList_()").items.filter((x) => x.kind === "review");
  let item = attn.filter((x) => x.codes.indexOf("EV-S1") !== -1)[0];
  ok(item && item.what === "card payment" && /still owed/.test(item.reason), "Needs attention lists it for Finance: " + JSON.stringify(item));
  confirm("TKTS1A");
  ok(order("S1").received === "10" && run(`TBL.Requests.filter(function (r) { return r.id.indexOf("S1") !== -1; }).length`) === 1, "checking again doesn't count it twice or list it twice");
  r = create("TKTS1A");
  ok(r.v && r.v.url && sq.lastLink.quick_pay.price_money.amount === 1500, "Pay by card again asks only for the $15 still owed");
  pay(order("S1").squareOrderId.split(" ").pop(), 1500);
  r = confirm("TKTS1A");
  ok(r.v.paid === true && order("S1").status === "paid" && order("S1").received === "25" && order("S1").squarePaymentId.split(" ").length === 2, "paying the rest by card: paid, $25 received, both payments kept");
  run(`dismissReview_(S, "${item.id}")`);
  ok(!run("attentionList_()").items.some((x) => x.id === item.id), "Finance presses Done and it leaves the list");

  // the order was cancelled while they were on Square
  run(`ord("X1", "EV1", "awaiting", 12.5); tk("TKTX1A", "X1", "EV1", "awaiting", 12.5);`);
  create("TKTX1A");
  run(`order("X1").status = "cancelled"; ticket("TKTX1A").status = "cancelled";`);
  pay(order("X1").squareOrderId, 1250);
  r = call(`confirmSquareWebhook_({ squareOrderId: "${order("X1").squareOrderId}" })`);
  o = order("X1");
  ok(r.v.paid === false && o.status === "cancelled" && o.received === "12.5" && o.squarePaymentId, "cancelled meanwhile: the money is recorded as received, the order stays cancelled");
  ok(/was cancelled/.test(o.notes) && run("attentionList_()").items.some((x) => x.kind === "review" && x.codes.indexOf("EV-X1") !== -1), "and Finance is told (notes + Needs attention)");
  call(`confirmSquareWebhook_({ squareOrderId: "${order("X1").squareOrderId}" })`);
  ok(order("X1").received === "12.5", "a repeat notification doesn't add it again");

  // paid by e-transfer AND by card
  run(`ord("T1", "EV1", "awaiting", 12.5); tk("TKTT1A", "T1", "EV1", "awaiting", 12.5);`);
  create("TKTT1A");
  run(`markOrderPaid_(S, "T1")`);
  pay(order("T1").squareOrderId, 1250);
  call(`confirmSquareWebhook_({ squareOrderId: "${order("T1").squareOrderId}" })`);
  o = order("T1");
  ok(o.status === "paid" && o.paidBy === "Fin Exec" && o.received === "25" && /paid twice/.test(o.notes), "paid twice (e-transfer, then card): $25 received and flagged as maybe paid twice");

  // The buyer's return page must catch a double payment even if the webhook never arrives.
  run(`ord("TR1", "EV1", "awaiting", 12.5); tk("TKTTR1A", "TR1", "EV1", "awaiting", 12.5);`);
  create("TKTTR1A");
  run(`markOrderPaid_(S, "TR1")`);
  pay(order("TR1").squareOrderId, 1250);
  const doubleReturn = confirm("TKTTR1A");
  confirm("TKTTR1A");
  ok(doubleReturn.v.paid && order("TR1").received === "25" && run(`TBL.Refunds.filter(r => r.orderId === "TR1" && r.status === "owed").length`) === 1,
     "returning from Square catches a double payment once without relying on the webhook");

  // a payment Square hasn't completed, or in another currency, is never counted
  run(`ord("U1", "EV1", "awaiting", 12.5); tk("TKTU1A", "U1", "EV1", "awaiting", 12.5);`);
  create("TKTU1A");
  pay(order("U1").squareOrderId, 1250, { status: "APPROVED" });
  pay(order("U1").squareOrderId, 1250, { amount_money: { amount: 1250, currency: "USD" } });
  r = confirm("TKTU1A");
  ok(r.v.paid === false && order("U1").status === "awaiting" && !order("U1").squarePaymentId && order("U1").received === "", "not COMPLETED or not CAD: nothing recorded");

  // ================= 8. Square switched off =================
  squareOff();
  const pe = call(`publicEvent_("ev1")`).v;
  ok(pe.ok && pe.cardEnabled === false, "publicEvent: cardEnabled false");
  ok(run(`registrationReply_(order("B1"), [ticket("TKTB1A")], "pay@css.test", ev("EV1"))`).cardEnabled === false, "registration reply: cardEnabled false");
  run(`ord("N1", "EV1", "awaiting", 12.5); tk("TKTN1A", "N1", "EV1", "awaiting", 12.5);`);
  ok(call(`getTicket_(sec("TKTN1A"))`).v.cardEnabled === false, "ticket page: cardEnabled false");
  before = fetchStub.calls.length;
  r = create("TKTN1A");
  ok(r.error === "CARD_UNAVAILABLE" && /e-transfer/.test(r.message) && fetchStub.calls.length === before, "Pay by card is refused (CARD_UNAVAILABLE) without calling Square");
  ok(confirm("TKTN1A").v.paid === false, "the confirm check simply says not paid");
  ok(call(`route_({ action: "confirmSquareWebhook", squareOrderId: "SQORD0001" })`).v.ignored === true && fetchStub.calls.length === before, "a notification is ignored");
  ok(call(`markOrderPaid_(S, "N1")`).v.ok && order("N1").status === "paid" && fetchStub.calls.length === before, "e-transfer works exactly as before");
  const sOff = run(`getSettings_("").settings`);
  ok(sOff.squareConfigured === false && sOff.squareEnvironment === "production", "Settings: card payments off");
  squareOn();
  ok(call(`publicEvent_("ev1")`).v.cardEnabled === true && run(`registrationReply_(order("B1"), [ticket("TKTB1A")], "pay@css.test", ev("EV1"))`).cardEnabled === true && call(`getTicket_(sec("TKTN1A"))`).v.cardEnabled === true, "switched on: cardEnabled true on all three");
  const sOn = run(`getSettings_("").settings`);
  ok(sOn.squareConfigured === true && sOn.squareEnvironment === "sandbox" && JSON.stringify(sOn).indexOf(TOKEN) === -1, "Settings: on, in sandbox, and never the token");
  const health = () => run("healthCheck_()").checks.filter((c) => c.name === "Card payments (Square)");
  const hOn = health();
  ok(hOn.length === 1 && hOn[0].ok === true && /test mode/.test(hOn[0].detail) && JSON.stringify(run("healthCheck_()")).indexOf(TOKEN) === -1, "System health: an information line when card payments are on (never the token)");
  store.SQUARE_ACCESS_TOKEN = "";
  ok(run("cardEnabled_()") === false, "a token without a location (or the reverse) counts as off");
  ok(health().length === 0, "System health: no card line when they are off");
  squareOn();

  // Square refuses (bad token): plain words, no token
  store.SQUARE_ACCESS_TOKEN = "a-wrong-token";
  run(`ord("K1", "EV1", "awaiting", 12.5); tk("TKTK1A", "K1", "EV1", "awaiting", 12.5);`);
  r = create("TKTK1A");
  ok(r.error === "CARD_UNAVAILABLE" && /e-transfer/.test(r.message) && r.message.indexOf("a-wrong-token") === -1, "Square says the token is wrong: a plain message, without the token: " + r.message);
  const errs = run("__errors.join(' | ')");
  ok(errs.indexOf("a-wrong-token") === -1 && errs.indexOf(TOKEN) === -1 && /Square \/v2\/online-checkout\/payment-links: 401 UNAUTHORIZED/.test(errs), "the health check's last error names Square's answer but never the token: " + errs.slice(-80));
  squareOn();

  // ================= Settings page: saving the Square keys =================
  {
    const NEW = "NEWTOKEN_abcdefghijklmnopqrstu";
    const realHandler = fetchStub.handler;
    fetchStub.handler = (url, opts) => {
      const m = /\/v2\/locations\/([^/?]+)$/.exec(url);
      if (!m) return realHandler(url, opts);
      if (opts.headers.Authorization !== "Bearer " + NEW) return { code: 401, body: { errors: [{ code: "UNAUTHORIZED" }] } };
      if (m[1] === "LOCUSD") return { code: 200, body: { location: { id: "LOCUSD", currency: "USD", status: "ACTIVE" } } };
      if (m[1] !== "LOCNEW") return { code: 404, body: { errors: [{ code: "NOT_FOUND" }] } };
      return { code: 200, body: { location: { id: "LOCNEW", currency: "CAD", status: "ACTIVE" } } };
    };
    run(`var __realConfig = getConfig_; getConfig_ = function () { var c = __realConfig(); c.password = "exec-pass-1"; c.adminPassword = "admin-pass-2"; return c; };`);
    squareOff();
    const save = (input) => call(`saveSettings_(S, "", ${JSON.stringify(input)})`);
    let r = save({ squareEnvironment: "sandbox", squareLocationId: "LOCNEW", squareAccessToken: "wrong_token_abcdefghijklmnop" });
    ok(r.error === "BAD_REQUEST" && /access token/.test(r.message) && !store.SQUARE_ACCESS_TOKEN && r.message.indexOf("wrong_token") === -1, "Settings: a token Square refuses is not saved, and isn't repeated back: " + r.message);
    r = save({ squareEnvironment: "sandbox", squareLocationId: "LOCX", squareAccessToken: NEW });
    ok(r.error === "BAD_REQUEST" && /no location/.test(r.message) && !store.SQUARE_LOCATION_ID, "Settings: an unknown location ID is not saved");
    r = save({ squareEnvironment: "sandbox", squareLocationId: "LOCUSD", squareAccessToken: NEW });
    ok(r.error === "BAD_REQUEST" && /Canadian dollars/.test(r.message) && !store.SQUARE_ACCESS_TOKEN, "Settings: a location that doesn't take CAD is refused");
    r = save({ squareEnvironment: "sandbox", squareLocationId: "bad id!", squareAccessToken: NEW });
    ok(r.error === "BAD_REQUEST" && /location ID/.test(r.message), "Settings: a badly copied location ID is refused before asking Square");
    r = save({ squareEnvironment: "sandbox", squareLocationId: "LOCNEW" });
    ok(r.error === "BAD_REQUEST" && /both/.test(r.message), "Settings: a location without any token is refused");
    r = save({ squareEnvironment: "sandbox", squareLocationId: "LOCNEW", squareAccessToken: NEW });
    ok(r.ok && store.SQUARE_ACCESS_TOKEN === NEW && store.SQUARE_LOCATION_ID === "LOCNEW" && store.SQUARE_ENV === "sandbox" && run("cardEnabled_()") === true, "Settings: good keys are checked with Square and saved; card payments are on");
    ok(JSON.stringify(r.v).indexOf(NEW) === -1 && /test mode/.test(r.v.message), "Settings: the reply never contains the token and says test mode");
    let s = run(`getSettings_("").settings`);
    ok(s.squareTokenSet === true && s.squareLocationId === "LOCNEW" && s.squareEnvironment === "sandbox" && JSON.stringify(s).indexOf(NEW) === -1, "Settings page: shows the location, that a token is saved, test mode, never the token");
    const before = fetchStub.calls.length;
    r = save({ squareEnvironment: "sandbox", squareLocationId: "LOCNEW" });
    ok(r.ok && r.v.changed.length === 0 && fetchStub.calls.length === before, "Settings: saving with the token box blank and nothing changed does nothing");
    r = save({ squareEnvironment: "production", squareLocationId: "LOCNEW" });
    ok(r.ok && store.SQUARE_ACCESS_TOKEN === NEW && store.SQUARE_ENV === "" && fetchStub.calls[fetchStub.calls.length - 1].url.indexOf("https://connect.squareup.com/") === 0, "Settings: switching to real payments keeps the saved token and checks it with real Square");
    r = save({ clearSquare: true });
    ok(r.ok && !store.SQUARE_ACCESS_TOKEN && !store.SQUARE_LOCATION_ID && !store.SQUARE_ENV && run("cardEnabled_()") === false, "Settings: Turn off card payments removes the keys");
    s = run(`getSettings_("").settings`);
    ok(s.squareConfigured === false && s.squareTokenSet === false && s.squareLocationId === "", "Settings page: shows card payments off");
    run(`getConfig_ = __realConfig;`);
    fetchStub.handler = realHandler;
    squareOn();
  }

  // Activity wording
  const line = run(`activitySummary_({ action: "order.paid.card", target: "EV-A1", details: JSON.stringify({ amount: 25, tickets: 2 }) }, {})`);
  ok(line === "a card payment of $25 through Square paid EV-A1 (2 tickets)" && run(`activityGroup_("order.paid.card")`) === "payments", "Activity: " + line);
  ok(run(`activityGroup_("order.card.review")`) === "payments", "card payments to check are under Payments");

  // ================= 9. Buyer pays Square fee + Audit regression checks =================
  {
    // Fees are off by default and cannot be enabled for real payments, even through Script Properties.
    delete store.SQUARE_PASS_FEE;
    ok(run(`cardQuote_(1000).chargeCents`) === 1000, "an unset fee setting never adds a buyer fee");
    store.SQUARE_PASS_FEE = "true";
    delete store.SQUARE_ENV;
    ok(run(`cardQuote_(1000).chargeCents`) === 1000 && run(`squareConfig_().passFee`) === false, "production ignores an enabled buyer-fee property");
    store.SQUARE_ENV = "sandbox";
    const q10 = run(`cardQuote_(1000)`), q25 = run(`cardQuote_(2500)`);
    ok(q10.dueCents === 1000 && q10.feeCents === 61 && q10.chargeCents === 1061, "$10.00 order grosses up to $10.61 ($0.61 fee)");
    ok(q25.dueCents === 2500 && q25.feeCents === 106 && q25.chargeCents === 2606, "$25.00 order grosses up to $26.06 ($1.06 fee)");

    run(`ord("BF1", "EV1", "awaiting", 10); tk("TKTBF1A", "BF1", "EV1", "awaiting", 10);`);
    const regRep = run(`registrationReply_(order("BF1"), [ticket("TKTBF1A")], "pay@css.test", ev("EV1"))`);
    const tixRep = call(`getTicket_(sec("TKTBF1A"))`).v;
    ok(regRep.cardTotal === 10.61 && regRep.cardFee === 0.61 && tixRep.cardTotal === 10.61 && tixRep.cardFee === 0.61, "registration and ticket replies expose cardTotal ($10.61) and cardFee ($0.61)");

    const bfCreate = create("TKTBF1A");
    ok(bfCreate.ok && sq.lastLink.order && sq.lastLink.order.line_items.length === 2 &&
       sq.lastLink.order.line_items[0].base_price_money.amount === 1000 &&
       sq.lastLink.order.line_items[1].name === "Online card processing fee" &&
       sq.lastLink.order.line_items[1].base_price_money.amount === 61, "checkout sends itemized ticket ($10.00) + Online card processing fee ($0.61)");

    pay(order("BF1").squareOrderId, 1061);
    const bfConf = confirm("TKTBF1A");
    const bfOrd = order("BF1");
    ok(bfConf.v.paid === true && bfOrd.status === "paid" && bfOrd.received === "10" && !/more than was owed/.test(bfOrd.notes),
       "when $10.61 arrives, $10.00 ticket revenue is recorded in received with NO false overpayment warning");
    const bfLog = logOf("order.paid.card", "EV-BF1")[0];
    ok(bfLog && bfLog.details.amount === 10 && bfLog.details.fee === 0.61 && bfLog.details.charged === 10.61, "Activity details record ticket amount ($10), fee ($0.61) and total charged ($10.61)");

    // Settings can update fee toggle/rates without re-calling Square when keys didn't change
    run(`var __cfg2 = getConfig_; getConfig_ = function () { var c = __cfg2(); c.password = "exec-pass-1"; c.adminPassword = "admin-pass-2"; return c; };`);
    const callsBefore = fetchStub.calls.length;
    const productionFee = call(`saveSettings_(S, "", { squareEnvironment: "production", squarePassFee: true })`);
    ok(productionFee.error === "BAD_REQUEST" && store.SQUARE_ENV === "sandbox" && fetchStub.calls.length === callsBefore,
       "Settings refuses a real-payment surcharge before saving or calling Square");
    const feeSave = call(`saveSettings_(S, "", { squarePassFee: true, squareFeePercent: "2.8", squareFeeFixed: "0.30" })`);
    run(`getConfig_ = __cfg2;`);
    ok(feeSave.ok && feeSave.v.changed.indexOf("card fee settings") !== -1 && fetchStub.calls.length === callsBefore && store.SQUARE_FEE_PERCENT === "2.8",
       "Settings saves updated card fee rates without extra Square calls");
    delete store.SQUARE_FEE_PERCENT; delete store.SQUARE_FEE_FIXED;
    store.SQUARE_PASS_FEE = "false";

    // Audit fix A1: Interrupted ticket confirmation repairs remaining group tickets on retry, webhook, or door scan
    run(`ord("IR1", "EV1", "awaiting", 25); tk("TKTIR1A", "IR1", "EV1", "awaiting", 12.5); tk("TKTIR1B", "IR1", "EV1", "awaiting", 12.5); __tix.length = 0;`);
    create("TKTIR1A");
    pay(order("IR1").squareOrderId, 2500);
    run(`var __u = updateRow_, __boom = true; updateRow_ = function(tbl, id, ch, h) { if (tbl === "Tickets" && id === "TKTIR1B" && __boom) { __boom = false; throw new Error("Simulated timeout"); } return __u(tbl, id, ch, h); };`);
    const cut = confirm("TKTIR1A");
    run(`updateRow_ = __u;`);
    ok(!cut.ok && order("IR1").status === "paid" && ticket("TKTIR1B").status === "awaiting" && run("__tix.length") === 0, "mid-save timeout left order paid, friend's ticket awaiting, and 0 emails sent");
    const repConfirm = confirm("TKTIR1B");
    ok(repConfirm.ok && repConfirm.v.paid === true && ticket("TKTIR1B").status === "paid" && run("__tix.length") === 2, "re-running confirmCardPayment repairs the stuck friend ticket and sends both emails");
    run(`ticket("TKTIR1B").status = "awaiting";`);
    sq.down = true;
    const outageRepair = confirm("TKTIR1B");
    sq.down = false;
    ok(outageRepair.ok && outageRepair.v.paid && ticket("TKTIR1B").status === "paid", "a Square outage cannot block repair of an already-paid group ticket");

    // Door scan also repairs a stuck awaiting ticket on a paid order straight away
    run(`ord("IR2", "EV1", "paid", 25, { paidBy: "Square (Card)", received: "25" }); tk("TKTIR2A", "IR2", "EV1", "paid", 12.5); tk("TKTIR2B", "IR2", "EV1", "awaiting", 12.5);`);
    const doorRepair = call(`REQ_SCANNER_ = true; scan_(DOOR, "EV1", "https://events.ucalgarycss.ca/ticket.html?t=" + sec("TKTIR2B"), false)`);
    ok(doorRepair.ok && doorRepair.v.result.color === "green" && ticket("TKTIR2B").status === "paid" && ticket("TKTIR2B").checkedInAt,
       "door scan repairs a stuck awaiting ticket on a paid order and checks the attendee in green");

    // Audit fix A2: Odd card payments (cancelled order X1 & double-paid order T1 from earlier) created Refunds rows, and Finance can record refund by card
    const rfX1 = run(`TBL.Refunds.filter(function (r) { return r.orderId === "X1" && r.status === "owed"; })[0]`);
    const rfT1 = run(`TBL.Refunds.filter(function (r) { return r.orderId === "T1" && r.status === "owed"; })[0]`);
    ok(rfX1 && rfX1.owed === 12.5 && rfT1 && rfT1.owed === 12.5, "cancelled and double-paid card orders create real Refunds owed rows");
    const recCard = call(`recordRefund_(S, { refundId: "${rfX1.id}", amount: 12.5, method: "card", date: "2026-10-02", note: "Refunded in Square" })`);
    ok(recCard.ok && recCard.v.remaining === 0 && recCard.v.refund.status === "returned" && recCard.v.refund.returns[0].method === "card",
       "Finance can record returning a Square card payment with method 'card'");
    call(`confirmSquareWebhook_({ squareOrderId: "${order("X1").squareOrderId}" })`);
    ok(run(`TBL.Refunds.filter(r => r.orderId === "X1").length`) === 1 && run(`availableReceivedCents_(order("X1"))`) === 0,
       "a notification after recording a refund does not create another refund or make the returned money available");

    // If Sheets fails after counting the payment, the next buyer return must finish the refund without counting twice.
    run(`ord("OC1", "EV1", "awaiting", 25); tk("TKTOC1A", "OC1", "EV1", "awaiting", 25);`);
    create("TKTOC1A");
    pay(order("OC1").squareOrderId, 3000);
    run(`var __insertCard = insertRow_; insertRow_ = function(tbl, rec) { if (tbl === "Refunds" && rec.orderId === "OC1") throw new Error("Simulated refund save timeout"); return __insertCard(tbl, rec); };`);
    const refundCut = confirm("TKTOC1A");
    run(`insertRow_ = __insertCard;`);
    const refundRetry = confirm("TKTOC1A");
    confirm("TKTOC1A");
    const recoveredRefunds = run(`TBL.Refunds.filter(r => r.orderId === "OC1")`);
    ok(!refundCut.ok && refundRetry.v.paid && order("OC1").received === "30" && recoveredRefunds.length === 1 && recoveredRefunds[0].owed === 5,
       "retrying a cut-off overpayment creates exactly one $5 refund while keeping $30 received");

    // Restoring a cancelled order whose late card payment has NOT been returned waives the refund and marks it paid
    run(`ord("XR1", "EV1", "awaiting", 12.5); tk("TKTXR1A", "XR1", "EV1", "awaiting", 12.5);`);
    create("TKTXR1A");
    run(`order("XR1").status = "cancelled"; ticket("TKTXR1A").status = "cancelled";`);
    pay(order("XR1").squareOrderId, 1250);
    call(`confirmSquareWebhook_({ squareOrderId: "${order("XR1").squareOrderId}" })`);
    const restLate = call(`restoreOrder_(S, "XR1")`);
    const rfXR1 = run(`TBL.Refunds.filter(function (r) { return r.orderId === "XR1"; })[0]`);
    ok(restLate.ok && restLate.v.status === "paid" && order("XR1").status === "paid" && order("XR1").received === "12.5" && ticket("TKTXR1A").status === "paid" && rfXR1.status === "waived",
       "Restore on a cancelled order with an unreturned late card payment waives the refund and confirms the order as paid without doubling received");

    // Audit fix A3a & A3b: Partial payment reuses the newest open link; a fully refunded completed link is never reused
    run(`ord("PR1", "EV1", "awaiting", 25); tk("TKTPR1A", "PR1", "EV1", "awaiting", 25);`);
    const prFirst = create("TKTPR1A");
    pay(order("PR1").squareOrderId, 1000);
    const prSecond = create("TKTPR1A");
    const postsAfterSecond = posts();
    const prThird = create("TKTPR1A");
    ok(prSecond.v.url !== prFirst.v.url && prThird.v.url === prSecond.v.url && posts() === postsAfterSecond,
       "after a partial card payment, the new checkout link for the remaining balance IS reused within 30 minutes");

    run(`ord("RFU1", "EV1", "awaiting", 25); tk("TKTRFU1A", "RFU1", "EV1", "awaiting", 25);`);
    const rfuFirst = create("TKTRFU1A");
    const deadSq = order("RFU1").squareOrderId;
    pay(deadSq, 2500, { refunded_money: { amount: 2500, currency: "CAD" } });
    sq.orders[deadSq].state = "COMPLETED";
    const rfuSecond = create("TKTRFU1A");
    ok(rfuSecond.ok && rfuSecond.v.url !== rfuFirst.v.url, "a Square link whose payment was refunded in full is never handed back as an active link");
  }

  // ================= The token never reaches a page =================
  ok(replies.every((x) => JSON.stringify(x).indexOf(TOKEN) === -1), "the Square token is in none of " + replies.length + " replies");
  ok(fetchStub.calls.filter((c) => c.url.indexOf(TOKEN) !== -1).length === 0, "and never in a web address");

  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
}
