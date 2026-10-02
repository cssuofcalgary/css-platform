const { sent, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", ticketTypes:[{id:"T2",name:"General",price:9}], questions:[], codePrefix:"MJ", archivedAt:"", summary:{} }];
TBL.Orders = []; TBL.Tickets = [];
insertRow_("Orders", { id:"O1", code:"MJ-1", eventId:"EV1", payerName:"P", payerEmail:"p@x.ca", total:9, status:"paid", createdAt:"2026-10-01T00:00:00Z", notes:"" });
for (var i = 0; i < 5; i++) insertRow_("Tickets", { id:"TK"+i, secret:("s"+i+"0000000000000000000000000").slice(0,30), orderId:"O1", eventId:"EV1", name:"N"+i, email:"n"+i+"@x.ca", ucid:"", memberId:"", ticketType:"General", price:9, answers:{}, flag:"", status:"paid", checkedInAt:"", createdAt:"2026-10-0"+(i+1)+"T00:00:00Z", emailedAt:"" });
var __mailLog = [];
`);
const mails = () => run("__mailLog.length");

// ---- Two presses at the same moment: the second one runs while the first is still sending its first email
run(`
var __real = sendTicketEmail_; var __nested = null; var __first = true;
sendTicketEmail_ = function (event, t) {
  __mailLog.push(t.id);
  if (__first) { __first = false; __nested = sendPendingTicketEmails_(null); }   // the second exec presses Send now here
  return true;
};
`);
const a = run("sendPendingTicketEmails_(null)");
const nested = run("__nested");
ok(mails() === 5, "5 tickets, 5 emails in total (not 10): " + mails());
ok(run("new Set(__mailLog).size") === 5, "no ticket was emailed twice");
ok(nested.sent === 0, "the second press found nothing left to send (it skipped what the first had claimed)");
ok(run("TBL.Tickets.every(function (t) { return /^20/.test(t.emailedAt); })"), "every ticket ends up stamped with a real sent time (no claim left behind)");

// ---- A failed send gives the claim back
run(`TBL.Tickets.forEach(function (t) { t.emailedAt = ""; }); __mailLog.length = 0;
sendTicketEmail_ = function (event, t) { __mailLog.push(t.id); return t.id !== "TK2"; };`);
const f = run("sendPendingTicketEmails_(null)");
ok(f.sent === 4 && f.waiting === 1, "one failed send: 4 sent, 1 still waiting: " + JSON.stringify(f));
ok(run('TBL.Tickets.filter(function (t) { return t.id === "TK2"; })[0].emailedAt') === "", "the failed ticket is free to be tried again");
run(`sendTicketEmail_ = function (event, t) { __mailLog.push(t.id); return true; };`);
ok(run("sendPendingTicketEmails_(null)").sent === 1, "the next press sends just the one that failed");

// ---- Count and limit
run(`TBL.Tickets.forEach(function (t) { t.emailedAt = ""; }); __mailLog.length = 0;`);
const lim = run("sendPendingTicketEmails_(null, 2)");
ok(lim.sent === 2 && lim.waiting === 3, "limit 2 sends the 2 oldest, 3 still waiting");
ok(run("__mailLog.join(',')") === "TK0,TK1", "oldest first");

// ---- A claim left by a run that died: recovered after the timeout, not before
run(`TBL.Tickets.forEach(function (t) { t.emailedAt = ""; }); __mailLog.length = 0;
TBL.Tickets[0].emailedAt = "claim:" + new Date().toISOString();                                  // being sent right now
TBL.Tickets[1].emailedAt = "claim:" + new Date(Date.now() - 30 * 60000).toISOString();           // claimed 30 min ago, never finished`);
ok(run("listOrders_(\"EV1\", { filter: \"all\" }).unsentEmails") === 4, "the unsent count includes the stale claim but not the fresh one (4)");
const rec = run("sendPendingTicketEmails_(null)");
ok(rec.sent === 4 && run("__mailLog.indexOf(\"TK0\")") === -1 && run("__mailLog.indexOf(\"TK1\")") !== -1, "stale claim is sent, the fresh claim is left to the run that owns it");

// ---- Resend: sends already-emailed tickets again, still skips a fresh claim
run(`TBL.Tickets.forEach(function (t) { t.emailedAt = new Date().toISOString(); }); __mailLog.length = 0;
TBL.Tickets[3].emailedAt = "claim:" + new Date().toISOString();`);
run("sendPendingTicketEmails_(\"O1\", 0, true)");
ok(run("__mailLog.length") === 4 && run("__mailLog.indexOf(\"TK3\")") === -1, "resend sends the 4 emailed tickets again and skips the one being sent now");

// ---- Test addresses are never emailed
run(`TBL.Tickets.forEach(function (t) { t.emailedAt = ""; }); __mailLog.length = 0; TBL.Tickets[0].email = "someone@example.test"; isTestAddress_ = function (e) { return /\.test$/.test(e); };`);
run("sendPendingTicketEmails_(null)");
ok(run("TBL.Tickets[0].emailedAt") === "test address, not sent" && run("__mailLog.indexOf(\"TK0\")") === -1, "test addresses are stamped, not emailed");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
