// Disable keeps a registration and its money, while freeing room and rejecting its original QR.
const assert = require("node:assert/strict");
const { ctx, sent, run } = require("./harness.js");
let checks = 0;
function test(name, fn) { fn(); checks++; console.log("PASS " + name); }
function call(fn, ...args) { return run(fn + "(" + args.map((x) => JSON.stringify(x)).join(",") + ")"); }
const session = { name: "Test Exec", role: "exec" };
const enable = (ticketIds, enabled, extra) => call("setTicketEnabled_", session, Object.assign({ orderId: "O1", ticketIds, enabled }, extra));
run(`
function table_() {}
function findTicketFresh_(kind,value) { return TBL.Tickets.find(function(t) {return t[kind === "secret" ? "secret" : "id"] === value;}); }
function resetAvailability_(status,price) {
  TBL.Events = [{id:"EV1",slug:"test-event",name:"TEST Ticket availability",date:"2099-01-01",startTime:"18:00",endTime:"21:00",location:"TEST",status:"published",entryOpen:"TRUE",capacity:2,capacityRule:"paid",ticketTypes:[{id:"TG",name:"General",price:price}],questions:[],archivedAt:""}];
  TBL.Orders = [{id:"O1",eventId:"EV1",code:"TEST-1234",status:status,payerName:"Alex Test",payerEmail:"alex@example.com",total:price*2,received:status === "paid" ? String(price*2) : "",notes:"Existing notes"}];
  TBL.Tickets = [0,1].map(function(i) {return {id:i ? "TKTB22222222" : "TKTA22222222",secret:(i ? "b" : "a").repeat(32),orderId:"O1",eventId:"EV1",name:i ? "Jamie Test" : "Alex Test",email:i ? "jamie@example.com" : "alex@example.com",ucid:i ? "30123458" : "30123457",memberId:"",ticketType:"General",price:price,status:status,disabledFrom:"",answers:{},flag:"",note:"Attendee note",checkedInAt:"",checkedInBy:"",emailedAt:""}; });
  TBL.Refunds=[]; TBL.Requests=[]; TBL.Waitlist=[]; TBL.Feedback=[]; TBL.Log=[];
}
resetAvailability_("paid",5);
`);
const first = "TKTA22222222", second = "TKTB22222222";
const originalOrder = JSON.stringify(run("TBL.Orders[0]"));
test("disable leaves the registration and all its money untouched", () => {
  const r = enable([first], false, { requestId: "disable-request-1111" });
  assert.equal(r.count, 1); assert.equal(r.enabled, false);
  assert.equal(JSON.stringify(run("TBL.Orders[0]")), originalOrder);
  assert.equal(run("TBL.Tickets[0].status"), "disabled");
  assert.equal(run("TBL.Tickets[0].disabledFrom"), "paid");
  assert.equal(run("TBL.Tickets[1].status"), "paid");
  assert.equal(run("TBL.Tickets[0].note"), "Attendee note");
  assert.equal(run("TBL.Refunds.length"), 0); assert.equal(sent.length, 0);
});
test("a disabled ticket frees its place without leaving the default attendee list", () => {
  const summary = call("eventSummary_", "EV1", {});
  assert.equal(summary.spotsTaken, 1); assert.equal(summary.totals.registered, 1);
  assert.equal(summary.totals.disabled, 1); assert.equal(summary.totals.closed, 0);
  assert.equal(summary.attendees.length, 2); assert.equal(summary.attendees[0].status, "disabled");
  assert.equal(summary.money.received, 10);
  const orders = call("listOrders_", "EV1", { filter: "paid" });
  assert.equal(orders.orders.length, 1); assert.equal(orders.orders[0].tickets[0].status, "disabled");
});
test("the original QR is rejected even at the help desk", () => {
  const scan = (atDesk) => call("scanCode_", { name: "Door" }, "EV1", "a".repeat(32), atDesk);
  assert.equal(scan(false).result.color, "red"); assert.equal(scan(true).result.color, "red");
  assert.match(scan(true).result.message, /disabled/i); assert.equal(run("TBL.Tickets[0].checkedInAt"), "");
});
test("My tickets retains the disabled entry without a usable QR secret", () => {
  const k = call("linkKey_", "tix", "alex@example.com");
  const list = call("myTickets_", { email: "alex@example.com", k });
  assert.equal(list.tickets.length, 1); assert.equal(list.tickets[0].status, "disabled"); assert.equal(list.tickets[0].secret, "");
  assert.equal(call("getTicket_", "a".repeat(32)).ticket.status, "disabled");
});
test("disabled tickets are not counted as pending emails or sent", () => {
  assert.equal(call("emailStatus_").waiting, 1);
  const r = call("sendPendingTicketEmails_", "O1");
  assert.equal(r.notEmailed, 0);
  assert.equal(run("TBL.Tickets[1].emailedAt"), "test address, not sent");
  assert.equal(run("TBL.Tickets[0].emailedAt"), "");
});
test("the same disable press remains idempotent after an enable", () => {
  enable([first], true);
  const r = enable([first], false, { requestId: "disable-request-1111" });
  assert.equal(r.count, 1); assert.equal(run("TBL.Tickets[0].status"), "paid");
  assert.equal(run("spotsTaken_(findEvent_(function(e){return e.id === 'EV1';}))"), 2);
});
test("enabling an existing disabled ticket does not create any new record or email", () => {
  run('resetAvailability_("paid",5)'); enable([first], false);
  const beforeMail = sent.length;
  const r = enable([first], true, { requestId: "enable-request-1111" });
  assert.equal(r.count, 1); assert.equal(run("TBL.Tickets[0].status"), "paid");
  assert.equal(run("TBL.Tickets[0].disabledFrom"), "");
  assert.equal(run("TBL.Tickets.length"), 2); assert.equal(run("TBL.Orders.length"), 1);
  assert.equal(sent.length, beforeMail);
  assert.equal(enable([first], true, { requestId: "enable-request-1111" }).count, 1);
});
test("an attendee already checked in cannot be disabled", () => {
  run('resetAvailability_("paid",5); TBL.Tickets[0].checkedInAt = "2026-11-22T12:00:00Z"');
  assert.throws(() => enable([first], false), (e) => e.code === "BAD_REQUEST" && /check-in/.test(e.message));
  assert.equal(run("TBL.Tickets[0].status"), "paid");
});
test("enabling checks current capacity before changing the ticket", () => {
  run('resetAvailability_("paid",5)'); enable([first], false);
  run('TBL.Tickets.push(Object.assign({},TBL.Tickets[1],{id:"TKTC22222222",name:"Casey Test",email:"casey@example.com",ucid:"30123459"}))');
  assert.throws(() => enable([first], true), (e) => e.code === "OVER_CAPACITY");
  assert.equal(run("TBL.Tickets[0].status"), "disabled");
  assert.equal(enable([first], true, { force: true }).count, 1);
});
test("overriding capacity never overrides another active registration for that attendee", () => {
  run('resetAvailability_("paid",5)'); enable([first], false);
  run('TBL.Tickets.push(Object.assign({},TBL.Tickets[0],{id:"TKTC22222222",orderId:"O2",status:"paid"}))');
  assert.throws(() => enable([first], true, { force: true }), (e) => e.code === "ALREADY_REGISTERED");
  assert.equal(run("TBL.Tickets[0].status"), "disabled");
});
test("marking a free held order paid records zero and leaves disabled tickets disabled", () => {
  run('resetAvailability_("awaiting",0); TBL.Tickets[0].flag="Member price, but no membership found"');
  enable([first, second], false);
  const r = call("markPaidLocked_", session, "O1", false);
  assert.equal(r.confirmed, 0); assert.equal(run("TBL.Orders[0].status"), "paid");
  assert.equal(run("TBL.Orders[0].total"), 0);
  assert.ok(run('TBL.Tickets.every(function(t){return t.status === "disabled" && t.disabledFrom === "paid";})'));
  assert.match(run("TBL.Tickets[0].flag"), /Member price/);
  enable([first], true);
  assert.equal(run("TBL.Tickets[0].status"), "paid");
});
test("cancelling a disabled paid ticket remains separate and creates its normal refund record", () => {
  run('resetAvailability_("paid",5)'); enable([first], false);
  const r = call("invalidateTickets_", session, { orderId: "O1", ticketIds: [first], requestId: "cancel-disabled-1111" });
  assert.equal(r.refund.owed, 5); assert.equal(run("TBL.Tickets[0].status"), "refunded");
  assert.equal(run("TBL.Tickets[1].status"), "paid"); assert.equal(run("TBL.Orders[0].total"), 5);
  assert.throws(() => enable([first], true), (e) => e.code === "BAD_REQUEST");
});
test("cancelling only the active sibling keeps the disabled ticket and its money on the order", () => {
  run('resetAvailability_("paid",5)'); enable([first], false);
  const r = call("invalidateTickets_", session, { orderId: "O1", ticketIds: [second], refundAmount: 0 });
  assert.equal(r.whole, false); assert.equal(run("TBL.Orders[0].status"), "paid");
  assert.equal(run("TBL.Orders[0].total"), 5); assert.equal(run("TBL.Tickets[0].status"), "disabled");
  call("restoreTickets_", session, { orderId: "O1", ticketIds: [second] });
  assert.equal(run("TBL.Orders[0].total"), 10);
});
test("whole-order cancellation includes disabled people", () => {
  run('resetAvailability_("awaiting",5)'); enable([first, second], false);
  const r = call("refundOrder_", session, "O1", "cancelled by attendee");
  assert.equal(r.whole, true); assert.equal(run("TBL.Orders[0].status"), "cancelled");
  assert.ok(run('TBL.Tickets.every(function(t){return t.status === "cancelled";})'));
});
test("disabling still works with capacity set to count all active registrations", () => {
  run('resetAvailability_("awaiting",5); TBL.Events[0].capacityRule = "all"');
  assert.equal(run("spotsTaken_(findEvent_(function(e){return e.id === 'EV1';}))"), 2);
  enable([first], false);
  assert.equal(run("spotsTaken_(findEvent_(function(e){return e.id === 'EV1';}))"), 1);
});
test("an interrupted disable rechecks check-in before retrying its saved writes", () => {
  run('resetAvailability_("paid",5)');
  const realApply = ctx.applyWrites_;
  ctx.applyWrites_ = () => { throw new Error("TEST interrupted before writes"); };
  assert.throws(() => enable([first], false, { requestId: "interrupted-disable-1111" }), /TEST interrupted/);
  ctx.applyWrites_ = realApply;
  run('TBL.Tickets[0].checkedInAt = "2026-11-22T12:00:00Z"');
  assert.throws(() => enable([first], false, { requestId: "interrupted-disable-1111" }), (e) => e.code === "BAD_REQUEST" && /check-in/.test(e.message));
  assert.equal(run("TBL.Tickets[0].status"), "paid");
  run('TBL.Tickets[0].checkedInAt = ""');
  assert.equal(enable([first], false, { requestId: "interrupted-disable-1111" }).count, 1);
});
test("an interrupted enable never restores an outdated unpaid state after Finance confirms payment", () => {
  run('resetAvailability_("awaiting",0)'); enable([first], false);
  const realApply = ctx.applyWrites_;
  ctx.applyWrites_ = () => { throw new Error("TEST interrupted before writes"); };
  assert.throws(() => enable([first], true, { requestId: "interrupted-enable-1111" }), /TEST interrupted/);
  ctx.applyWrites_ = realApply;
  call("markPaidLocked_", session, "O1", false);
  const r = enable([first], true, { requestId: "interrupted-enable-1111" });
  assert.equal(r.error, "NEEDS_REVIEW"); assert.equal(run("TBL.Tickets[0].status"), "disabled");
  assert.equal(run("TBL.Tickets[0].disabledFrom"), "paid");
  enable([first], true, { requestId: "confirmed-enable-2222" });
  assert.equal(run("TBL.Tickets[0].status"), "paid");
});
test("a payment returned for a full event also cancels disabled siblings", () => {
  run('resetAvailability_("awaiting",5)'); enable([first], false);
  const r = call("applyTransfer_", session, { orderIds: ["O1"], amount: 10, full: "refund", requestId: "return-payment-1111" });
  assert.equal(r.mode, "refund"); assert.equal(run("TBL.Orders[0].status"), "cancelled");
  assert.ok(run('TBL.Tickets.every(function(t){return t.status === "cancelled";})'));
});
test("disabling an unpaid waitlist offer releases its held place", () => {
  run('resetAvailability_("paid",5); TBL.Orders[0].total=5; TBL.Orders[0].received="5"; TBL.Orders.push({id:"O2",eventId:"EV1",code:"TEST-2222",status:"awaiting",total:5}); TBL.Tickets[1].orderId="O2"; TBL.Tickets[1].status="awaiting"; TBL.Waitlist=[{id:"WL1",eventId:"EV1",status:"offered",orderId:"O2"}];');
  assert.equal(run('waitlistRoom_(findEvent_(function(e){return e.id === "EV1";})).free'), 0);
  call("setTicketEnabled_", session, { orderId: "O2", ticketIds: [second], enabled: false });
  assert.equal(run('waitlistRoom_(findEvent_(function(e){return e.id === "EV1";})).free'), 1);
  assert.equal(run('waitlistRoom_(findEvent_(function(e){return e.id === "EV1";})).outstanding'), 0);
  assert.equal(run("TBL.Waitlist[0].status"), "offered");
});
console.log(checks + " ticket availability checks passed");
