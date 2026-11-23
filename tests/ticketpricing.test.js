// Correcting a free/member ticket never invents payment or changes the membership record.
const assert = require("node:assert/strict");
const { ctx, run } = require("./harness.js");
let checks = 0;
const call = (fn, ...args) => run(fn + "(" + args.map((arg) => JSON.stringify(arg)).join(",") + ")");
const session = { name: "Test Admin", role: "admin" };
const edit = (changes = { ticketTypeId: "GENERAL" }, role = "admin") => call("updateTicket_", { name: "Test Editor", role }, "TKTA22222222", changes, "", {});
function test(name, fn) { run("resetPricing_()"); fn(); checks++; console.log("PASS " + name); }
run(`
function table_() {}
function findTicketFresh_(kind,value) { return TBL.Tickets.find(function(t) { return t[kind === "secret" ? "secret" : "id"] === value; }); }
var __pricingEmails = [];
function sendPendingTicketEmails_(orderId) {
  var ready = TBL.Tickets.filter(function(t) { return t.orderId === orderId && t.status === "paid" && !t.emailedAt; });
  ready.forEach(function(t) { __pricingEmails.push(t.id); t.emailedAt = "TEST sent"; });
  return {sent:ready.length, waiting:0, notEmailed:0};
}
function resetPricing_() {
  TBL.Events = [{id:"EV1",slug:"pricing",name:"TEST Ticket pricing",status:"published",date:"2099-01-01",entryOpen:"TRUE",capacity:20,capacityRule:"paid",questions:[],ticketTypes:[
    {id:"MEMBER",name:"Member",price:0,needsMembership:true},
    {id:"GENERAL",name:"Non-member",price:5,needsMembership:false},
    {id:"PREMIUM",name:"Premium",price:8,needsMembership:false}
  ]}];
  TBL.Orders = [{id:"O1",eventId:"EV1",code:"TEST-1234",status:"awaiting",total:0,received:"",payerName:"Alex Test",payerEmail:"alex@example.com",paidAt:"",paidBy:"",notes:"Review membership"}];
  TBL.Tickets = [0,1].map(function(i) {return {id:i ? "TKTB22222222" : "TKTA22222222",secret:(i ? "b" : "a").repeat(32),eventId:"EV1",orderId:"O1",name:i ? "Jamie Test" : "Alex Test",email:i ? "jamie@example.com" : "alex@example.com",ucid:i ? "30123458" : "30123457",memberId:"",ticketType:"Member",price:0,status:"awaiting",flag:"Member price, but no membership found",disabledFrom:"",checkedInAt:"",emailedAt:"",answers:{}};});
  TBL.__members = [{name:"Alex Test",ucid:"30123457",paid:false}];
  TBL.Refunds=[]; TBL.Requests=[]; TBL.Waitlist=[]; TBL.Log=[];
  __pricingEmails=[];
}
`);

test("before approval, changing to Non-member updates the amount and clears only the member warning", () => {
  run('TBL.Tickets[0].flag += "; Check dietary request"');
  const reply = edit();
  assert.equal(reply.total.now, 5); assert.equal(reply.total.stillDue, 5);
  assert.equal(run("TBL.Orders[0].status"), "awaiting");
  assert.equal(run("receivedOf_(TBL.Orders[0])"), 0);
  assert.equal(run("TBL.Tickets[0].ticketType"), "Non-member");
  assert.equal(run("TBL.Tickets[0].flag"), "Check dietary request");
  assert.equal(run("TBL.__members[0].paid"), false);
  assert.equal(run("__pricingEmails.length"), 0);
});

test("Mark paid Free approves the event ticket without changing their membership", () => {
  const reply = call("markOrderPaid_", session, "O1", false, "", "approve-free-1111");
  assert.equal(reply.confirmed, 2);
  assert.equal(run("TBL.Orders[0].total"), 0);
  assert.equal(run("receivedOf_(TBL.Orders[0])"), 0);
  assert.equal(run("TBL.Tickets[0].status"), "paid");
  assert.match(run("TBL.Tickets[0].flag"), /Member price/);
  assert.equal(run("TBL.__members[0].paid"), false);
});

test("after free approval, repricing asks for the new balance and keeps the sibling approved", () => {
  call("markOrderPaid_", session, "O1", false, "");
  const emailsBefore = run("__pricingEmails.length");
  const reply = edit();
  assert.equal(reply.orderStatus, "awaiting"); assert.equal(reply.total.stillDue, 5);
  assert.equal(run("TBL.Orders[0].total"), 5); assert.equal(run("TBL.Orders[0].received"), "0");
  assert.equal(run("TBL.Orders[0].paidAt"), ""); assert.equal(run("TBL.Orders[0].paidBy"), "");
  assert.equal(run("TBL.Tickets[0].status"), "awaiting"); assert.equal(run("TBL.Tickets[0].emailedAt"), "");
  assert.equal(run("TBL.Tickets[1].status"), "paid");
  assert.equal(run("__pricingEmails.length"), emailsBefore);
  const finance = call("listOrders_", "EV1", {filter:"awaiting"});
  assert.equal(finance.orders[0].received, 0); assert.equal(finance.orders[0].stillDue, 5);
  assert.equal(finance.spotsTaken, 1);
  assert.equal(call("getTicket_", "a".repeat(32)).ticket.status, "awaiting");
  const scan = call("scanCode_", {name:"Test Door"}, "EV1", "a".repeat(32), true);
  assert.equal(scan.result.color, "orange"); assert.match(scan.result.message, /Not paid yet/);
});

test("recording the real difference confirms only the corrected ticket and records that money once", () => {
  call("markOrderPaid_", session, "O1", false, ""); edit();
  const req = {orderIds:["O1"],amount:5,requestId:"corrected-payment-1111"};
  const first = call("applyTransfer_", session, req);
  const repeat = call("applyTransfer_", session, req);
  assert.equal(first.results[0].stillDue, 0); assert.equal(repeat.results[0].stillDue, 0);
  assert.equal(run("TBL.Orders[0].status"), "paid"); assert.equal(run("TBL.Orders[0].received"), "5");
  assert.equal(run("TBL.Tickets[0].status"), "paid");
  assert.equal(run("__pricingEmails.length"), 3);
  assert.equal(run("TBL.Orders.length"), 1); assert.equal(run("TBL.Tickets.length"), 2);
});

test("a disabled free ticket stays disabled while its corrected charge waits for payment", () => {
  call("markOrderPaid_", session, "O1", false, "");
  call("setTicketEnabled_", session, {orderId:"O1",ticketIds:["TKTA22222222"],enabled:false});
  edit();
  assert.equal(run("TBL.Tickets[0].status"), "disabled"); assert.equal(run("TBL.Tickets[0].disabledFrom"), "awaiting");
  assert.equal(run("TBL.Orders[0].received"), "0");
  const emailsBefore = run("__pricingEmails.length");
  call("applyTransfer_", session, {orderIds:["O1"],amount:5,requestId:"disabled-payment-1111"});
  assert.equal(run("TBL.Tickets[0].status"), "disabled"); assert.equal(run("TBL.Tickets[0].disabledFrom"), "paid");
  assert.equal(run("__pricingEmails.length"), emailsBefore);
  assert.equal(call("listOrders_", "EV1", {filter:"paid"}).spotsTaken, 1);
});

test("an existing payment that covers the new price keeps the ticket paid", () => {
  run('TBL.Orders[0].status="paid"; TBL.Orders[0].received="5"; TBL.Tickets.forEach(function(t){t.status="paid";});');
  const reply = edit();
  assert.equal(reply.orderStatus, "paid"); assert.equal(reply.total.stillDue, 0);
  assert.equal(run("TBL.Tickets[0].status"), "paid"); assert.equal(run("TBL.Orders[0].received"), "5");
});

test("a previous ordinary payment is preserved and only the price increase remains due", () => {
  run('TBL.Orders[0].status="paid"; TBL.Orders[0].total=5; TBL.Tickets[0].ticketType="Non-member"; TBL.Tickets[0].price=5; TBL.Tickets.forEach(function(t){t.status="paid";});');
  const reply = edit({ticketTypeId:"PREMIUM"});
  assert.equal(reply.total.stillDue, 3); assert.equal(run("TBL.Orders[0].received"), "5");
  call("applyTransfer_", session, {orderIds:["O1"],amount:3,requestId:"upgrade-payment-1111"});
  assert.equal(run("TBL.Orders[0].received"), "8"); assert.equal(run("TBL.Orders[0].status"), "paid");
});

test("lowering a paid ticket's price preserves the actual payment without inventing a refund", () => {
  run('TBL.Orders[0].status="paid"; TBL.Orders[0].total=8; TBL.Tickets[0].ticketType="Premium"; TBL.Tickets[0].price=8; TBL.Tickets.forEach(function(t){t.status="paid";});');
  const reply = edit();
  assert.equal(reply.total.now, 5); assert.equal(reply.orderStatus, "paid");
  assert.equal(run("receivedOf_(TBL.Orders[0])"), 8); assert.equal(run("TBL.Refunds.length"), 0);
});

test("changing the ticket and email together does not send an unpaid replacement ticket", () => {
  call("markOrderPaid_", session, "O1", false, "");
  const emailsBefore = run("__pricingEmails.length");
  edit({ticketTypeId:"GENERAL",email:"new@example.com"});
  assert.equal(run("TBL.Tickets[0].email"), "new@example.com");
  assert.equal(run("TBL.Orders[0].payerEmail"), "new@example.com");
  assert.equal(run("__pricingEmails.length"), emailsBefore);
});

test("a checked-in attendee retains their check-in while Finance sees the extra charge", () => {
  call("markOrderPaid_", session, "O1", false, "");
  run('TBL.Tickets[0].checkedInAt="2026-11-22T12:00:00Z"');
  const reply = edit();
  assert.equal(reply.total.stillDue, 5); assert.equal(run("TBL.Tickets[0].status"), "paid");
  assert.equal(run("TBL.Tickets[0].checkedInAt"), "2026-11-22T12:00:00Z");
});

test("a ticket-type correction still requires the admin password and makes no partial writes", () => {
  const before = JSON.stringify(run("[TBL.Tickets,TBL.Orders,TBL.__members]"));
  assert.throws(() => edit({ticketTypeId:"GENERAL"}, "exec"), (err) => err.code === "ADMIN_ONLY");
  assert.equal(JSON.stringify(run("[TBL.Tickets,TBL.Orders,TBL.__members]")), before);
});

test("retrying a correction repairs an interrupted order write without adding money or tickets", () => {
  call("markOrderPaid_", session, "O1", false, "");
  const originalUpdate = ctx.updateRow_;
  let fail = true;
  ctx.updateRow_ = (...args) => {
    if (args[0] === "Orders" && fail) { fail = false; throw new Error("TEST interrupted order write"); }
    return originalUpdate(...args);
  };
  try { assert.throws(() => edit(), /TEST interrupted/); }
  finally { ctx.updateRow_ = originalUpdate; }
  const reply = edit();
  assert.equal(reply.orderStatus, "awaiting"); assert.equal(reply.total.stillDue, 5);
  assert.equal(run("TBL.Orders[0].received"), "0"); assert.equal(run("TBL.Orders[0].total"), 5);
  assert.equal(run("TBL.Tickets[0].status"), "awaiting");
  assert.equal(run("TBL.Orders.length"), 1); assert.equal(run("TBL.Tickets.length"), 2);
  assert.equal(edit().changed, false);
});

console.log(checks + " ticket pricing checks passed");
