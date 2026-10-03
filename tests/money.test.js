// Money: cancelling, invalidating tickets (whole order or one person), refunds owed and returned, putting tickets back,
// and every awkward e-transfer (too little, too much, someone else's name, several orders at once, cancelled, event full).
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { ok: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };

run(`
function ev(id, extra) {
  return Object.assign({ id:id, slug:id.toLowerCase(), name:"Event " + id, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
    status:"published", entryOpen:"FALSE", ticketTypes:[{ id:"TG", name:"General", price:8 }], questions:[], codePrefix:"EV", archivedAt:"", summary:{}, updatedAt:"2026-10-01T00:00:00Z" }, extra || {});
}
TBL.Events = [ev("EV1"), ev("EVC", { capacity:2 })];
TBL.Orders = []; TBL.Tickets = []; TBL.Refunds = [];
function table_() {}
function throttle_() {}
function withLock_(fn) { return fn(); }
var __tix = [];
function sendTicketEmail_(event, t) { __tix.push(t.id); return true; }
function emailBrand_() { return { signerName: "A", signerRole: "B", buttonColor: "#000000" }; }
var S = { name: "Fin Exec", role: "exec" };
function ord(id, eventId, status, total, extra) { insertRow_("Orders", Object.assign({ id:id, code:"X-"+id, eventId:eventId, payerName:"Payer "+id, payerEmail:id.toLowerCase()+"@x.ca", etransferName:"", total:total, status:status, createdAt:"2026-10-01T00:00:00Z", notes:"", remindedAt:"", cancelRequestedAt:"", received:"" }, extra || {})); }
function tk(id, orderId, eventId, status, price, extra) { insertRow_("Tickets", Object.assign({ id:id, secret:(id+"0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:eventId, name:"N"+id, email:id.toLowerCase()+"@x.ca", ucid:"", memberId:"", ticketType:"General", price:price, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt: status === "paid" ? "sent" : "" }, extra || {})); }
function order(id) { return TBL.Orders.filter(function (o) { return o.id === id; })[0]; }
function ticket(id) { return TBL.Tickets.filter(function (t) { return t.id === id; })[0]; }
function refundsOf(id) { return TBL.Refunds.filter(function (r) { return r.orderId === id; }); }
function reset() { TBL.Orders = []; TBL.Tickets = []; TBL.Refunds = []; __tix.length = 0; }
`);

// ================= Invalidate one person in a group order =================
run(`reset(); ord("G1", "EV1", "paid", 32); tk("TKTG1A", "G1", "EV1", "paid", 8); tk("TKTG1B", "G1", "EV1", "paid", 8); tk("TKTG1C", "G1", "EV1", "paid", 8); tk("TKTG1D", "G1", "EV1", "paid", 8);`);
let r = run(`invalidateTickets_(S, { orderId: "G1", ticketIds: ["TKTG1B"], reason: "can't come" })`);
ok(r.invalidated === 1 && r.qrRejected === true && r.whole === false && r.orderStatus === "paid", "one person of four is invalidated; the order stays paid for the other three: " + JSON.stringify(r));
ok(run('ticket("TKTG1B").status') === "refunded" && run('["TKTG1A","TKTG1C","TKTG1D"].every(function (id) { return ticket(id).status === "paid"; })'), "only that ticket stops working");
ok(run('order("G1").total') === 24 && run('order("G1").received') === "32", "the order now costs $24 and still remembers $32 arrived");
ok(r.refund && r.refund.owed === 8 && run('refundsOf("G1")[0].status') === "owed", "$8 is written down as money owed back");
let lst = run('listOrders_("EV1", { filter: "all" })');
let card = lst.orders[0];
ok(card.refund.state === "owed" && card.refund.remaining === 8 && lst.counts.refundsOwed === 1 && lst.money.refundsOwed === 8, "the order list shows 'refund owed $8' and counts it");
ok(lst.money.received === 24 && lst.paidTickets === 3, "money received and paid tickets are now the net 24 / 3");

// the same ticket can't be invalidated twice
ok(fn('invalidateTickets_(S, { orderId: "G1", ticketIds: ["TKTG1B"] })').message.indexOf("already cancelled") !== -1, "an already-invalidated ticket is refused");
// a refund bigger than what arrived is refused
ok(/Only \$32/.test(fn('invalidateTickets_(S, { orderId: "G1", ticketIds: ["TKTG1C"], refundAmount: 99 })').message || "x"), "can't give back more than was received");
// keep a fee: refund less than the price
r = run(`invalidateTickets_(S, { orderId: "G1", ticketIds: ["TKTG1C"], refundAmount: 6, reason: "$2 fee kept" })`);
ok(r.refund.owed === 6 && run("refundsOf('G1').length") === 2, "a partial refund (keeping a $2 fee) writes down $6");
// a checked-in ticket can't be invalidated
run(`ticket("TKTG1D").checkedInAt = "2026-10-02T00:00:00Z";`);
const blocked = fn('invalidateTickets_(S, { orderId: "G1", ticketIds: ["TKTG1D"] })');
ok(/already checked in/.test(blocked.message) && /NTKTG1D/.test(blocked.message) && run('ticket("TKTG1D").status') === "paid", "a checked-in ticket is refused and named");

// ================= Recording the money going back =================
const rid = run('refundsOf("G1")[0].id');
ok(/how the money was returned/.test(fn(`recordRefund_(S, { refundId: "${rid}", amount: 8 })`).message), "a method is required");
ok(/future/.test(fn(`recordRefund_(S, { refundId: "${rid}", amount: 8, method: "cash", date: "2099-01-01" })`).message), "a date in the future is refused");
ok(/Only \$8/.test(fn(`recordRefund_(S, { refundId: "${rid}", amount: 20, method: "cash" })`).message), "can't record more than is owed");
r = run(`recordRefund_(S, { refundId: "${rid}", amount: 5, method: "e-transfer", date: "2026-10-02", by: "Jo Finance", note: "sent from CSS email" })`);
ok(r.remaining === 3 && run(`refundsOf("G1")[0].status`) === "owed", "returning $5 of $8 leaves $3 still owed");
ok(run('listOrders_("EV1", { filter: "all" })').money.refundsOwed === 6 + 3, "the totals show what is still owed: $3 + $6");
r = run(`recordRefund_(S, { refundId: "${rid}", amount: 3, method: "cash" })`);
ok(r.remaining === 0 && run(`refundsOf("G1")[0].status`) === "returned" && run('refundsOf("G1")[0].returns.length') === 2, "the rest closes it: returned, with both entries kept");
const ret = run('refundsOf("G1")[0].returns[0]');
ok(ret.method === "e-transfer" && ret.by === "Jo Finance" && ret.date === "2026-10-02" && ret.amount === 5, "each return keeps amount, method, date and who did it");
ok(/already returned/.test(fn(`recordRefund_(S, { refundId: "${rid}", amount: 1, method: "cash" })`).message), "a closed refund can't be recorded twice");

// put a ticket back, before and after money went back
const rid2 = run('refundsOf("G1")[1].id');
ok(/already returned/.test(fn('restoreTickets_(S, { orderId: "G1", ticketIds: ["TKTG1B"] })').message), "a ticket whose refund was already returned can't be put back");
r = run('restoreTickets_(S, { orderId: "G1", ticketIds: ["TKTG1C"] })');
ok(r.restored === 1 && run('ticket("TKTG1C").status') === "paid" && run('refundsOf("G1")[1].status') === "waived", "putting back a ticket before returning the money cancels that refund");
ok(run('order("G1").total') === 24, "and the order total counts it again ($24 = three valid tickets)");

// ================= Whole orders =================
run(`reset(); ord("W1", "EV1", "paid", 16); tk("TKTW1A", "W1", "EV1", "paid", 8); tk("TKTW1B", "W1", "EV1", "paid", 8);
     ord("U1", "EV1", "awaiting", 16); tk("TKTU1A", "U1", "EV1", "awaiting", 8); tk("TKTU1B", "U1", "EV1", "awaiting", 8);
     ord("H1", "EV1", "refunded", 9, { notes: "refunded by Old: sorry" }); tk("TKTH1A", "H1", "EV1", "refunded", 9);`);
r = run('refundOrder_(S, "W1", "event cancelled")');
ok(r.whole && r.orderStatus === "refunded" && r.refund.owed === 16 && run('order("W1").status') === "refunded", "refunding a whole paid order owes the full $16");
r = run('refundOrder_(S, "U1", "changed their mind")');
ok(r.whole && r.orderStatus === "cancelled" && r.refund === null && run('refundsOf("U1").length') === 0, "cancelling an unpaid order owes nothing");
ok(run('["TKTU1A","TKTU1B"].every(function (id) { return ticket(id).status === "cancelled"; })'), "its tickets are cancelled");
lst = run('listOrders_("EV1", { filter: "all" })');
const byId = (id) => lst.orders.find((o) => o.id === id);
ok(byId("W1").refund.state === "owed" && byId("U1").refund.state === "none", "refunded paid order: owed; cancelled unpaid: nothing");
ok(byId("H1").refund.state === "unrecorded" && lst.counts.refundsOwed === 1, "an old refunded order shows 'return not recorded' and is not counted as owed");
r = run('recordRefund_(S, { orderId: "H1", unknown: true })');
ok(r.remaining === 0 && run('refundsOf("H1")[0].status') === "returned" && run('refundsOf("H1")[0].returns[0].method') === "unknown", "'Money already returned' on an old refund records it with the date and method unknown");
ok(run('listOrders_("EV1", { filter: "all" }).orders.find(function (o) { return o.id === "H1"; }).refund.state') === "returned", "and it then shows as returned");

// undo a refund by mistake: nothing returned yet -> back to PAID, refund cancelled
r = run('restoreOrder_(S, "W1", false)');
ok(r.status === "paid" && run('order("W1").status') === "paid" && run('refundsOf("W1")[0].status') === "waived", "restoring a refunded order whose money was never returned makes it paid again");
ok(run('["TKTW1A","TKTW1B"].every(function (id) { return ticket(id).status === "paid"; })') && run("__tix.length") === 0, "its tickets work again and nobody is emailed");
// cancelling a refund needs a reason
run(`reset(); ord("C1", "EV1", "paid", 8); tk("TKTC1A", "C1", "EV1", "paid", 8); invalidateTickets_(S, { orderId: "C1", ticketIds: ["TKTC1A"] });`);
ok(/Say why/.test(fn(`cancelRefund_(S, "${run('refundsOf("C1")[0].id')}", "")`).message), "cancelling a refund needs a reason");
ok(run(`cancelRefund_(S, "${run('refundsOf("C1")[0].id')}", "recorded by mistake")`).ok && run('refundsOf("C1")[0].status') === "waived", "with a reason it is kept on record as cancelled");

// ================= E-transfers =================
const pay = (o) => fn(`applyTransfer_(S, ${JSON.stringify(Object.assign({ siteUrl: "" }, o))})`);
function fresh() { run(`reset(); ord("A1", "EV1", "awaiting", 16, { etransferName: "" }); tk("TKTA1A", "A1", "EV1", "awaiting", 8); tk("TKTA1B", "A1", "EV1", "awaiting", 8);
  ord("A2", "EV1", "awaiting", 8, { payerName: "Payer A1", payerEmail: "a1@x.ca" }); tk("TKTA2A", "A2", "EV1", "awaiting", 8);`); }

fresh();
let p = pay({ orderIds: ["A1"], amount: 16, senderName: "Mom Chan" });
ok(p.ok && p.ok.mode === "pay" && p.ok.confirmed === 2 && p.ok.shortBy === 0 && p.ok.extra === 0, "exact payment: confirmed 2 tickets: " + JSON.stringify(p.ok));
ok(run('order("A1").status') === "paid" && run('order("A1").received') === "16" && run('order("A1").etransferName') === "Mom Chan", "paid, $16 received, and the name on the transfer is saved");
ok(p.ok.emailsSent === 2 && run("__tix.length") === 2, "both tickets are emailed");

fresh();
ok(/short/.test(pay({ orderIds: ["A1"], amount: 11 }).message), "too little with no choice made is refused");
p = pay({ orderIds: ["A1"], amount: 11, short: "wait" });
ok(p.ok && p.ok.shortBy === 5 && p.ok.results[0].paid === false && p.ok.results[0].stillDue === 5, "too little + keep waiting: still $5 to come");
ok(run('order("A1").status') === "awaiting" && run('order("A1").received') === "11" && run("__tix.length") === 0, "the order stays unpaid with $11 received, no tickets emailed");
lst = run('listOrders_("EV1", { filter: "sorting" })');
ok(lst.orders.length === 1 && lst.orders[0].stillDue === 5 && lst.counts.needsSorting === 1 && lst.money.awaiting === 5 + 8, "it appears under 'needs sorting' with $5 still due");
p = pay({ orderIds: ["A1"], amount: 5 });
ok(p.ok && p.ok.confirmed === 2 && run('order("A1").status') === "paid" && run('order("A1").received') === "16", "the missing $5 later completes it");

fresh();
p = pay({ orderIds: ["A1"], amount: 14, short: "accept" });
ok(p.ok && run('order("A1").status') === "paid" && /accepted as paid in full/.test(run('order("A1").notes')), "too little + accept: paid in full, the shortfall is written in the notes");

fresh();
ok(/more than/.test(pay({ orderIds: ["A1"], amount: 20 }).message), "too much with no choice made is refused");
p = pay({ orderIds: ["A1"], amount: 20, over: "refund" });
ok(p.ok && p.ok.extra === 4 && p.ok.refund.owed === 4 && run('order("A1").status') === "paid" && run('order("A1").received') === "20", "too much + refund: paid, and $4 is written down as owed back");
ok(run('refundsOf("A1")[0].kind') === "overpayment", "as an overpayment");
fresh();
p = pay({ orderIds: ["A1"], amount: 20, over: "keep" });
ok(p.ok && p.ok.refund === null && /extra \$4 kept/.test(run('order("A1").notes')), "too much + keep: nothing owed, written in the notes");

fresh();
p = pay({ orderIds: ["A1", "A2"], amount: 24, senderName: "Dad Chan" });
ok(p.ok && p.ok.confirmed === 3 && run('order("A1").status') === "paid" && run('order("A2").status') === "paid", "one transfer covering two orders pays both");
ok(/together with X-A2/.test(run('order("A1").notes')) && /together with X-A1/.test(run('order("A2").notes')), "each order says which other order it was paid with");
fresh();
p = pay({ orderIds: ["A1", "A2"], amount: 20, short: "wait" });
ok(p.ok && p.ok.results[0].paid === true && p.ok.results[1].paid === false && p.ok.results[1].stillDue === 4, "a transfer too small for two orders pays the first and leaves $4 for the second");

ok(/already paid/.test(pay({ orderIds: ["A1"], amount: 5 }).message || ""), "paying an order that is already paid is refused (after it was paid above)") ;

// ---- A payment for a cancelled order
run(`reset(); ord("K1", "EV1", "cancelled", 8, { notes: "cancelled by Fin" }); tk("TKTK1A", "K1", "EV1", "cancelled", 8);`);
ok(/cancelled/.test(pay({ orderIds: ["K1"], amount: 8 }).message), "payment for a cancelled order needs a choice");
p = pay({ orderIds: ["K1"], amount: 8, late: "restore" });
ok(p.ok && run('order("K1").status') === "paid" && run('ticket("TKTK1A").status') === "paid", "put it back and confirm it");
run(`reset(); ord("K2", "EV1", "cancelled", 8, { notes: "cancelled by Fin" }); tk("TKTK2A", "K2", "EV1", "cancelled", 8);`);
p = pay({ orderIds: ["K2"], amount: 8, late: "refund", senderName: "Late Payer" });
ok(p.ok && p.ok.mode === "refund" && p.ok.refund.owed === 8 && run('order("K2").status') === "cancelled" && run('refundsOf("K2")[0].kind') === "late payment", "or refund the whole payment: the order stays cancelled and $8 is owed back");

// ---- The event is full
run(`reset(); ord("F0", "EVC", "paid", 16); tk("TKTF0A", "F0", "EVC", "paid", 8); tk("TKTF0B", "F0", "EVC", "paid", 8);
     ord("F1", "EVC", "awaiting", 8); tk("TKTF1A", "F1", "EVC", "awaiting", 8);`);
p = pay({ orderIds: ["F1"], amount: 8 });
ok(p.error === "OVER_CAPACITY" && run('order("F1").status') === "awaiting" && run('order("F1").received') === "", "event full: refused before anything is written");
p = pay({ orderIds: ["F1"], amount: 8, full: "refund" });
ok(p.ok && p.ok.mode === "refund" && run('order("F1").status') === "cancelled" && run('refundsOf("F1")[0].owed') === 8 && run('refundsOf("F1")[0].kind') === "event full", "event full + refund: the registration is cancelled and the money is owed back");
run(`ord("F2", "EVC", "awaiting", 8); tk("TKTF2A", "F2", "EVC", "awaiting", 8);`);
p = pay({ orderIds: ["F2"], amount: 8, full: "confirm" });
ok(p.ok && run('order("F2").status') === "paid", "event full + confirm anyway: paid over the limit");

// ---- Finding the order for a payment
run(`reset(); ord("M1", "EV1", "awaiting", 16, { code:"EV-4821", payerName:"Linda Chan", payerEmail:"linda@x.ca" }); tk("TKTM1A", "M1", "EV1", "awaiting", 8, { name:"Amy Chan" });
     ord("M2", "EV1", "awaiting", 8, { code:"EV-4822", payerName:"Linda Chan", payerEmail:"linda@x.ca" }); tk("TKTM2A", "M2", "EV1", "awaiting", 8, { name:"Ben Chan" });
     ord("M3", "EV1", "awaiting", 8, { code:"EV-9000", payerName:"Someone Else", payerEmail:"se@x.ca" }); tk("TKTM3A", "M3", "EV1", "awaiting", 8, { name:"Zed Else" });`);
let f = run('findTransfer_({ code: "ev 4821" })');
ok(f.candidates[0].code === "EV-4821" && f.candidates[0].reasons.indexOf("Code matches") !== -1, "a code typed any way finds the order");
f = run('findTransfer_({ amount: 16, name: "Wei Chan" })');
ok(f.candidates[0].code === "EV-4821" && f.candidates[0].reasons.indexOf("Amount matches") !== -1, "a payment under another name is found by amount (and part of the name)");
f = run('findTransfer_({ amount: 24, name: "Linda" })');
ok(f.groups.length === 1 && f.groups[0].codes.length === 2 && f.groups[0].total === 24, "one transfer that adds up to two of the same person's orders is suggested as a pair: " + JSON.stringify(f.groups));
ok(/Enter the amount/.test(fn("findTransfer_({})").message), "an empty search asks for something to search by");

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
