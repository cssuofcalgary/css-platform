const { run, sent } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:4, capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"FALSE", ticketTypes:[{id:"T2",name:"General",price:9}], questions:[], codePrefix:"MJ", archivedAt:"", summary:{} }];
TBL.Orders = []; TBL.Tickets = [];
function ord(id, status, notes) { insertRow_("Orders", { id:id, code:"MJ-"+id, eventId:"EV1", payerName:"P"+id, payerEmail:id+"@x.ca", total:9, status:status, createdAt:"2026-10-01T00:00:00Z", notes:notes||"", remindedAt:"x", cancelRequestedAt:"", cancelRequestedBy:"" }); }
function tk(id, orderId, status) { insertRow_("Tickets", { id:id, secret:(id+"0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:"EV1", name:"N"+id, email:"", ucid:"", memberId:"", ticketType:"General", price:9, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt:"" }); }
function withLock_(fn) { return fn(); }
function sendTicketEmail_() { return true; }
function emailBrand_() { return { signerName: "A", signerRole: "B", buttonColor: "#000000" }; }
var S = { name: "Fin", role: "exec" };
`);
const q = (code) => run(code);
const status = (table, id) => q(`TBL.${table}.filter(function (x) { return x.id === "${id}"; })[0].status`);

// ---- Repair: an order marked paid whose ticket was left waiting
q(`ord("A", "paid"); tk("TA1", "A", "paid"); tk("TA2", "A", "awaiting");`);
ok(q('listOrders_("EV1", { filter: "paid" }).orders[0].needsRepair') === true, "a paid order with a waiting ticket is flagged needsRepair");
ok(q('listOrders_("EV1", { filter: "paid" }).counts.needsRepair') === 1, "the count of orders needing repair is 1");
const rep = q('markOrderPaid_(S, "A", false, null)');
ok(rep.alreadyPaid === true && rep.repaired === 1, "pressing Mark paid again repairs it: " + JSON.stringify(rep));
ok(status("Tickets", "TA2") === "paid", "the left-over ticket is now paid");
ok(rep.emailsSent === 2, "the missing emails are sent (both tickets had none): " + rep.emailsSent);
ok(q('markOrderPaid_(S, "A", false, null)').repaired === 0 && q('listOrders_("EV1", { filter: "paid" }).counts.needsRepair') === 0, "a healthy paid order is left alone (nothing to repair)");

// ---- Restore
q(`ord("B", "cancelled"); tk("TB1", "B", "cancelled"); ord("C", "refunded"); tk("TC1", "C", "refunded"); ord("D", "awaiting"); tk("TD1", "D", "awaiting");`);
const r1 = q('restoreOrder_(S, "B", false)');
ok(r1.ok && r1.status === "awaiting" && r1.restored === 1 && status("Orders", "B") === "awaiting" && status("Tickets", "TB1") === "awaiting", "a cancelled order goes back to awaiting, with its ticket: " + JSON.stringify(r1));
ok(/restored from cancelled by Fin/.test(q('TBL.Orders.filter(function (o) { return o.id === "B"; })[0].notes')), "the order notes say who restored it");
ok(q('TBL.Orders.filter(function (o) { return o.id === "B"; })[0].remindedAt') === "", "reminder clock reset so it can be reminded again");
const r2 = q('restoreOrder_(S, "C", false)');
ok(r2.ok && status("Orders", "C") === "awaiting", "a refunded order goes back to awaiting");

let err = null;
try { q('restoreOrder_(S, "D", false)'); } catch (e) { err = e; }
ok(err && /Only a cancelled or refunded/.test(err.message), "an order that is not closed can't be restored");

// capacity 4, queue limit 5: paid 2 + awaiting (D, B, C = 3) = 5; restoring one more goes over
q(`ord("E", "cancelled"); tk("TE1", "E", "cancelled");`);
err = null;
try { q('restoreOrder_(S, "E", false)'); } catch (e) { err = e; }
ok(err && err.code === "OVER_CAPACITY", "no room: refused with OVER_CAPACITY: " + (err && err.message));
ok(status("Orders", "E") === "cancelled", "a refused restore changes nothing");
const forced = q('restoreOrder_(S, "E", true)');
ok(forced.ok && status("Orders", "E") === "awaiting", "Finance can restore anyway after the warning");

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
