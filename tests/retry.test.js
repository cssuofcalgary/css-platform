// Pressing a button twice / retries: Add registration, Mark paid, waitlist offers, e-transfers, refunds owed and money returned.
// The same press (same requestId) must always give the same saved answer and never a second order, ticket, payment or return:
// when the answer got lost, when the email step was busy after the save, and when the first try stopped halfway.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || "ERROR", msg: e.message }; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

run(`
function ev(id, extra) {
  return Object.assign({ id:id, slug:id.toLowerCase(), name:"TEST Event " + id, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"TRUE",
    status:"published", entryOpen:"FALSE", ticketTypes:[{ id:"TG", name:"General", price:20 }, { id:"TF", name:"Free", price:0 }], questions:[], codePrefix:"RT", archivedAt:"", summary:{},
    mailRegistration:"FALSE", mailTickets:"TRUE", mailReminders:"FALSE", updatedAt:"2026-10-01T00:00:00Z" }, extra || {});
}
function table_() {}
function throttle_() {}
var __tix = [], __reg = [];
function sendTicketEmail_(event, t) { __tix.push(t.id); return true; }
function sendRegistrationEmail_(event, order) { __reg.push(order.code); return true; }
var S = { name: "TEST Finance", role: "exec" };
var realInsert = insertRow_, realUpdate = updateRow_, realSend = sendPendingTicketEmails_;
function failNext(kind, table, times) {   // the next write(s) to this table fail, like Google timing out
  var left = times || 1;
  if (kind === "insert") insertRow_ = function (name, obj) { if (name === table && left-- > 0) throw new Error("TEST Service Spreadsheets timed out"); return realInsert(name, obj); };
  else updateRow_ = function (name, id, ch, r) { if (name === table && left-- > 0) throw new Error("TEST Service Spreadsheets timed out"); return realUpdate(name, id, ch, r); };
}
function healthy() { insertRow_ = realInsert; updateRow_ = realUpdate; sendPendingTicketEmails_ = realSend; }
function emailBusy() { sendPendingTicketEmails_ = function () { throw new ApiError_("BUSY", "TEST email claim lock busy"); }; }
function reset() {
  healthy();
  TBL.Events = [ev("EV1"), ev("EVF", { capacity: 1 })];
  TBL.Orders = []; TBL.Tickets = []; TBL.Refunds = []; TBL.Waitlist = []; TBL.Requests = []; __tix.length = 0; __reg.length = 0;
}
function ord(id, status, total, extra) { realInsert("Orders", Object.assign({ id:id, code:"RT-"+id, eventId:"EV1", payerName:"Payer "+id, payerEmail:id.toLowerCase()+"@example.com", etransferName:"", total:total, status:status, createdAt:"2026-10-01T00:00:00Z", notes:"", remindedAt:"", cancelRequestedAt:"", received:"" }, extra || {})); }
function tk(id, orderId, status, price) { realInsert("Tickets", { id:id, secret:(id+"0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:"EV1", name:"N"+id, email:id.toLowerCase()+"@example.com", ucid:"", memberId:"", ticketType:"General", price:price, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt: status === "paid" ? "sent" : "" }); }
function live(table) { return TBL[table].filter(function (r) { return r.status !== "cancelled"; }).length; }
function order(id) { return TBL.Orders.filter(function (o) { return o.id === id; })[0]; }
var ADD = { person: { name: "TEST Walk Up", email: "walkup@example.com", ticketTypeId: "TG", answers: {} }, etransferName: "W Up", notes: "" };
`);

// ================= F1: Add registration =================
run(`reset(); emailBusy();`);
let first = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0001")`);
ok(first.v && first.v.ok, "Add registration: a busy email step after the save is NOT an error (" + (first.err || "ok") + ")");
ok(first.v && first.v.emailsSent === 0, "Add registration: the reply says the email is still to be sent");
run(`healthy();`);
let again = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0001")`);
ok(again.v && same(again.v, first.v), "Add registration: the same press again gives the same answer");
ok(run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 1, "Add registration: still one order and one ticket");

// the saved answer itself is lost (the Requests tab could not be written): the order's own marker still stops a duplicate
run(`TBL.Requests = [];`);
again = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0001")`);
ok(again.v && again.v.code === first.v.code && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 1, "Add registration: even without the saved answer, the repeat finds the same order");

// a genuinely new press cannot book a second ticket for the same person
const second = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0002")`);
ok(second.err === "ALREADY_REGISTERED" && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 1, "Add registration: a new press (new id) still cannot duplicate an active attendee");

// stopped halfway: the order was written, the ticket was not, and closing the order failed too
run(`reset(); failNext("insert", "Tickets"); updateRow_ = function () { throw new Error("TEST Sheets down"); };`);
let half = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0003")`);
ok(half.err === "TEMPORARY" && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 0, "Add registration: halfway stop leaves one order, no ticket, and says try again");
run(`healthy();`);
let resumed = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0003")`);
ok(resumed.v && resumed.v.ok && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 1 && run(`TBL.Tickets[0].orderId === TBL.Orders[0].id`), "Add registration: the retry finishes the same order (one order, one ticket)");
ok(run(`TBL.Orders[0].status`) === "paid", "Add registration: the finished order is paid");
ok(run(`TBL.Tickets[0].emailedAt`) === "test address, not sent", "Add registration: the ticket email step ran for the finished ticket");

// stopped halfway but closing the order worked: the half order is cancelled, the retry makes one clean one
run(`reset(); failNext("insert", "Tickets");`);
half = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0004")`);
ok(half.err === "TEMPORARY" && run(`TBL.Orders[0].status`) === "cancelled", "Add registration: a half order that could be closed is cancelled");
resumed = fn(`addOrder_(S, "EV1", ADD, false, "", "add-press-0004")`);
ok(resumed.v && resumed.v.ok && run(`live("Orders")`) === 1 && run(`live("Tickets")`) === 1, "Add registration: the retry makes exactly one live registration");

// no id (an older dashboard): works as before
run(`reset();`);
ok(fn(`addOrder_(S, "EV1", ADD, false, "")`).v.ok && run(`TBL.Requests.length`) === 0, "Add registration: without an id it still works and saves nothing extra");

// ================= Mark paid =================
run(`reset(); ord("P1", "awaiting", 20); tk("TKTP1A", "P1", "awaiting", 20); emailBusy();`);
first = fn(`markOrderPaid_(S, "P1", false, "", "paid-press-0001")`);
ok(first.v && first.v.ok && first.v.confirmed === 1, "Mark paid: a busy email step after the save is NOT an error");
run(`healthy();`);
again = fn(`markOrderPaid_(S, "P1", false, "", "paid-press-0001")`);
ok(again.v && same(again.v, first.v), "Mark paid: the same press again gives the same answer (not 'already paid')");
run(`reset(); ord("P2", "awaiting", 20); tk("TKTP2A", "P2", "awaiting", 20); ord("P3", "awaiting", 20); tk("TKTP3A", "P3", "awaiting", 20);`);
first = fn(`markOrdersPaid_(S, ["P2", "P3"], "", "bulk-press-0001")`);
again = fn(`markOrdersPaid_(S, ["P2", "P3"], "", "bulk-press-0001")`);
ok(first.v.confirmed === 2 && same(again.v, first.v), "Mark paid (several): the same press again gives the same answer");

// ================= Public sign-up: a busy email step after a free sign-up =================
run(`reset(); emailBusy();`);
const reg = fn(`register_({ slug: "ev1", people: [{ name: "TEST Free Person", email: "free@example.com", ucid: "30123456", ticketTypeId: "TF", answers: {} }], requestId: "reg-press-0001" })`);
ok(reg.v && reg.v.ok && reg.v.order.status === "paid", "Sign-up: a free sign-up saved before a busy email step still answers ok");
run(`healthy();`);
const reg2 = fn(`register_({ slug: "ev1", people: [{ name: "TEST Free Person", email: "free@example.com", ucid: "30123456", ticketTypeId: "TF", answers: {} }], requestId: "reg-press-0001" })`);
ok(reg2.v && reg2.v.order.code === reg.v.order.code && run(`TBL.Orders.length`) === 1, "Sign-up: the same press again gives the same registration");

// ================= F4: waitlist offer =================
run(`reset(); realInsert("Waitlist", { id:"WL1", eventId:"EV1", name:"TEST Waiter", email:"wait@example.com", ucid:"", memberId:"", ticketTypeId:"TG", ticketType:"General", answers:{}, status:"waiting", createdAt:"2026-10-01T00:00:00Z", notes:"" });
  failNext("insert", "Tickets");`);
half = fn(`offerWaitlistSpot_(S, "WL1", false, "")`);
ok(half.err === "TEMPORARY" && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 0 && run(`TBL.Waitlist[0].status`) === "waiting", "Waitlist: a ticket write that fails stops with 'press Offer again' (one order, no ticket)");
run(`healthy();`);
const offered = fn(`offerWaitlistSpot_(S, "WL1", false, "", "wl-press-0001")`);
ok(offered.v && offered.v.ok && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 1, "Waitlist: pressing Offer again finishes the same order (one order, one ticket)");
ok(offered.v && offered.v.code === run(`TBL.Orders[0].code`) && run(`TBL.Waitlist[0].status`) === "offered" && run(`TBL.Waitlist[0].orderId === TBL.Orders[0].id`), "Waitlist: same payment code, entry linked to that order");
ok(run(`__reg.length`) === 1, "Waitlist: the payment instructions were sent once");
again = fn(`offerWaitlistSpot_(S, "WL1", false, "", "wl-press-0001")`);
ok(again.v && same(again.v, offered.v) && run(`TBL.Orders.length`) === 1 && run(`__reg.length`) === 1, "Waitlist: the same press again (answer lost) gives the same answer, no second order or email");
ok(fn(`offerWaitlistSpot_(S, "WL1", false, "", "wl-press-0002")`).err === "BAD_REQUEST", "Waitlist: a different, new press on an offered entry is still refused");

// stopped after the order and ticket, before the waitlist mark
run(`reset(); realInsert("Waitlist", { id:"WL2", eventId:"EV1", name:"TEST Waiter Two", email:"wait2@example.com", ucid:"", memberId:"", ticketTypeId:"TG", ticketType:"General", answers:{}, status:"waiting", createdAt:"2026-10-01T00:00:00Z", notes:"" });
  failNext("update", "Waitlist");`);
half = fn(`offerWaitlistSpot_(S, "WL2", false, "", "wl-press-0003")`);
ok(half.err === "TEMPORARY" && run(`TBL.Tickets.length`) === 1 && run(`TBL.Waitlist[0].status`) === "waiting", "Waitlist: stopped before marking the entry (order and ticket saved)");
run(`healthy();`);
resumed = fn(`offerWaitlistSpot_(S, "WL2", false, "", "wl-press-0003")`);
ok(resumed.v && resumed.v.ok && run(`TBL.Orders.length`) === 1 && run(`TBL.Tickets.length`) === 1 && run(`TBL.Waitlist[0].status`) === "offered", "Waitlist: the retry only marks the entry (still one order, one ticket)");

// ================= F5: e-transfers =================
run(`reset(); ord("T1", "awaiting", 20, { received: "0" }); tk("TKTT1A", "T1", "awaiting", 20);`);
const part = { orderIds: ["T1"], amount: 5, short: "wait", siteUrl: "", requestId: "pay-press-0001" };
first = fn(`applyTransfer_(S, ${JSON.stringify(part)})`);
again = fn(`applyTransfer_(S, ${JSON.stringify(part)})`);
ok(first.v && Number(run(`order("T1").received`)) === 5, "Transfer: a $5 part-payment is recorded");
ok(again.v && same(again.v, first.v) && Number(run(`order("T1").received`)) === 5, "Transfer: the same press again gives the same answer and still $5 received (not $10)");
run(`TBL.Requests = [];`);
// without the saved answer it would count again: the Requests row is what protects a repeat; a new press is a real second payment
const next = fn(`applyTransfer_(S, ${JSON.stringify(Object.assign({}, part, { requestId: "pay-press-0002" }))})`);
ok(next.v && Number(run(`order("T1").received`)) === 10, "Transfer: a genuinely new $5 payment (new id) is added");

// stopped halfway: the money was written on the order, then the refund of the extra failed
run(`reset(); ord("T2", "awaiting", 20, { received: "" }); tk("TKTT2A", "T2", "awaiting", 20); failNext("insert", "Refunds");`);
const over = { orderIds: ["T2"], amount: 25, over: "refund", siteUrl: "", requestId: "pay-press-0003" };
half = fn(`applyTransfer_(S, ${JSON.stringify(over)})`);
ok(half.err === "ERROR" && Number(run(`order("T2").received`)) === 25 && run(`TBL.Refunds.length`) === 0, "Transfer: stopped halfway (money written, refund not)");
run(`healthy();`);
resumed = fn(`applyTransfer_(S, ${JSON.stringify(over)})`);
ok(resumed.v && resumed.v.ok && Number(run(`order("T2").received`)) === 25, "Transfer: the retry does not add the $25 again");
ok(run(`TBL.Refunds.length`) === 1 && Number(run(`TBL.Refunds[0].owed`)) === 5 && run(`order("T2").status`) === "paid", "Transfer: the retry finishes it: one $5 refund owed, order paid");
again = fn(`applyTransfer_(S, ${JSON.stringify(over)})`);
ok(again.v && same(again.v, resumed.v) && run(`TBL.Refunds.length`) === 1, "Transfer: and pressing again after that gives the same answer");

// ================= F5: money returned =================
run(`reset(); realInsert("Refunds", { id:"RF1", orderId:"O1", orderCode:"RT-1", eventId:"EV1", owed:20, returns:[], status:"owed", ticketIds:[] });`);
const back = { refundId: "RF1", amount: 5, method: "cash", date: "2026-01-01", requestId: "ret-press-0001" };
first = fn(`recordRefund_(S, ${JSON.stringify(back)})`);
again = fn(`recordRefund_(S, ${JSON.stringify(back)})`);
ok(first.v && first.v.remaining === 15, "Return: $5 of $20 recorded, $15 left");
ok(again.v && same(again.v, first.v) && run(`TBL.Refunds[0].returns.length`) === 1, "Return: the same press again gives the same answer, one return");
run(`TBL.Requests = [];`);   // the saved answer is lost: the return itself carries the press id
again = fn(`recordRefund_(S, ${JSON.stringify(back)})`);
ok(again.v && again.v.remaining === 15 && run(`TBL.Refunds[0].returns.length`) === 1, "Return: even without the saved answer, the same press is not counted twice");
const back2 = fn(`recordRefund_(S, ${JSON.stringify(Object.assign({}, back, { requestId: "ret-press-0002" }))})`);
ok(back2.v && back2.v.remaining === 10 && run(`TBL.Refunds[0].returns.length`) === 2, "Return: a genuinely second $5 (new id) is recorded");

// an old refunded order (no refund row yet): the row and its return are one write, so a repeat finds it
run(`reset(); ord("H1", "refunded", 20, { received: "20" });`);
first = fn(`recordRefund_(S, { orderId: "H1", unknown: true, requestId: "ret-press-0003" })`);
run(`TBL.Requests = [];`);
again = fn(`recordRefund_(S, { orderId: "H1", unknown: true, requestId: "ret-press-0003" })`);
ok(first.v && again.v && again.v.remaining === 0 && run(`TBL.Refunds.length`) === 1, "Return (old refund): the same press again makes no second refund row");

// ================= F5: refund owed (invalidate tickets) =================
run(`reset(); ord("I1", "paid", 40); tk("TKTI1A", "I1", "paid", 20); tk("TKTI1B", "I1", "paid", 20);`);
const inv = { orderId: "I1", ticketIds: ["TKTI1B"], reason: "TEST can't come", requestId: "inv-press-0001" };
first = fn(`invalidateTickets_(S, ${JSON.stringify(inv)})`);
again = fn(`invalidateTickets_(S, ${JSON.stringify(inv)})`);
ok(first.v && first.v.refund && same(again.v, first.v) && run(`TBL.Refunds.length`) === 1, "Refund owed: the same press again gives the same answer, one refund owed");
run(`reset(); ord("I2", "paid", 40); tk("TKTI2A", "I2", "paid", 20); tk("TKTI2B", "I2", "paid", 20); failNext("insert", "Refunds");`);
const inv2 = { orderId: "I2", ticketIds: ["TKTI2B"], reason: "TEST", requestId: "inv-press-0002" };
half = fn(`invalidateTickets_(S, ${JSON.stringify(inv2)})`);
ok(half.err && run(`TBL.Tickets[1].status`) === "refunded" && run(`TBL.Refunds.length`) === 0, "Refund owed: stopped halfway (ticket stopped, refund owed not written)");
run(`healthy();`);
resumed = fn(`invalidateTickets_(S, ${JSON.stringify(inv2)})`);
ok(resumed.v && resumed.v.ok && run(`TBL.Refunds.length`) === 1 && Number(run(`TBL.Refunds[0].owed`)) === 20 && Number(run(`order("I2").total`)) === 20, "Refund owed: the retry finishes it (one $20 refund owed, order total $20)");

// ---- Independent review R1/R2: a retry must never mistake someone else's payment for its own, or write a refund it can't justify
// R1: two real $5 payments. A is cut off before its order write, B goes through, then A is retried.
run(`reset(); ord("R1", "awaiting", 20, { received: "0" }); tk("TKTR1", "R1", "awaiting", 20); failNext("update", "Orders");`);
const payA = { orderIds: ["R1"], amount: 5, short: "wait", requestId: "transfer-A-001" };
half = fn(`applyTransfer_(S, ${JSON.stringify(payA)})`);
ok(half.err && Number(run(`order("R1").received`)) === 0, "R1: payment A is cut off before the order is changed");
run(`healthy();`);
const payB = fn(`applyTransfer_(S, ${JSON.stringify({ orderIds: ["R1"], amount: 5, short: "wait", requestId: "transfer-B-001" })})`);
ok(payB.v && payB.v.ok && Number(run(`order("R1").received`)) === 5, "R1: a separate $5 payment B goes through");
let retryA = fn(`applyTransfer_(S, ${JSON.stringify(payA)})`);
ok(retryA.v && retryA.v.ok === false && retryA.v.error === "NEEDS_REVIEW", "R1: retrying A asks Finance to check instead of claiming it was saved: " + JSON.stringify(retryA.v && retryA.v.message));
ok(Number(run(`order("R1").received`)) === 5 && /RT-R1/.test(retryA.v.message), "R1: nothing more is recorded, and the message names the order to check");
ok(same(fn(`applyTransfer_(S, ${JSON.stringify(payA)})`).v, retryA.v) && Number(run(`order("R1").received`)) === 5, "R1: pressing A again gives the same 'check it' answer and still records nothing");
const payA2 = fn(`applyTransfer_(S, ${JSON.stringify(Object.assign({}, payA, { requestId: "transfer-A-002" }))})`);
ok(payA2.v && payA2.v.ok && Number(run(`order("R1").received`)) === 10, "R1: after checking, Finance records A as a new press and both $5 payments count ($10)");

// R2: A is $25 on a $20 order (refund $5 extra), cut off before the order write; B records $10; A is retried.
run(`reset(); ord("R2", "awaiting", 20, { received: "0" }); tk("TKTR2", "R2", "awaiting", 20); failNext("update", "Orders");`);
const overA = { orderIds: ["R2"], amount: 25, over: "refund", requestId: "transfer-A-003" };
half = fn(`applyTransfer_(S, ${JSON.stringify(overA)})`);
run(`healthy();`);
fn(`applyTransfer_(S, ${JSON.stringify({ orderIds: ["R2"], amount: 10, short: "wait", requestId: "transfer-B-003" })})`);
retryA = fn(`applyTransfer_(S, ${JSON.stringify(overA)})`);
ok(retryA.v && retryA.v.error === "NEEDS_REVIEW", "R2: retrying the overpayment after another payment asks Finance to check");
ok(run(`TBL.Refunds.length`) === 0 && Number(run(`order("R2").received`)) === 10 && run(`order("R2").status`) === "awaiting",
  "R2: no $5 refund owed is created and the order isn't marked paid (received stays $10)");

// The ordinary case still works: the order step saved, then the reply got lost. The repeat knows it was this press.
run(`reset(); ord("R3", "awaiting", 20, { received: "0" }); tk("TKTR3", "R3", "awaiting", 20); failNext("insert", "Refunds");`);
const overC = { orderIds: ["R3"], amount: 25, over: "refund", requestId: "transfer-C-001" };
half = fn(`applyTransfer_(S, ${JSON.stringify(overC)})`);
ok(half.err && Number(run(`order("R3").received`)) === 25 && run(`order("R3").lastWrite`) === "applyTransfer:transfer-C-001", "The order remembers which press changed it");
run(`healthy();`);
const resumedC = fn(`applyTransfer_(S, ${JSON.stringify(overC)})`);
ok(resumedC.v && resumedC.v.ok && Number(run(`order("R3").received`)) === 25 && run(`TBL.Refunds.length`) === 1 && run(`order("R3").status`) === "paid",
  "Cut off after the order step: the retry finishes (received $25 once, one $5 refund owed, paid)");

// Even when another payment left the exact numbers this press planned, a repeat that already changed the order isn't confused.
run(`reset(); ord("R4", "awaiting", 20, { received: "0" }); tk("TKTR4", "R4", "awaiting", 20);`);
const payD = { orderIds: ["R4"], amount: 5, short: "wait", requestId: "transfer-D-001" };
const firstD = fn(`applyTransfer_(S, ${JSON.stringify(payD)})`);
ok(firstD.v && same(fn(`applyTransfer_(S, ${JSON.stringify(payD)})`).v, firstD.v) && Number(run(`order("R4").received`)) === 5, "A finished $5 press repeated: same answer, $5 once");

// Refund owed: the order changed between a cut-off try and its retry -> no refund owed is written, Finance checks.
run(`reset(); ord("R5", "paid", 40); tk("TKTR5A", "R5", "paid", 20); tk("TKTR5B", "R5", "paid", 20); failNext("update", "Orders");`);
const invR = { orderId: "R5", ticketIds: ["TKTR5B"], reason: "TEST", requestId: "inv-press-0005" };
half = fn(`invalidateTickets_(S, ${JSON.stringify(invR)})`);
run(`healthy(); realUpdate("Orders", "R5", { total: 30, notes: "TEST changed by someone else" });`);
const invRetry = fn(`invalidateTickets_(S, ${JSON.stringify(invR)})`);
ok(invRetry.v && invRetry.v.error === "NEEDS_REVIEW" && run(`TBL.Refunds.length`) === 0 && run(`TBL.Tickets[1].status`) === "paid",
  "Refund owed: the order changed since the cut-off try, so nothing more is written (no refund owed, ticket still valid)");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL RETRY TESTS PASS");
process.exit(fails ? 1 : 0);
