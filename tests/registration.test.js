// Registration: one set of rules for the event site and the member portal, member verification, durable retries,
// a half-written order never staying behind, and the event being checked again inside the lock.
const { ctx, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
function ev(id, slug, extra) {
  return Object.assign({ id:id, slug:slug, name:"Event " + id, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
    status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"EV", archivedAt:"", summary:{}, updatedAt:"2026-10-01T00:00:00Z" }, extra || {});
}
TBL.Events = [
  ev("EVP", "paid-night", { ticketTypes:[{ id:"TG", name:"General", price:9 }, { id:"TM", name:"Member", price:4, needsMembership:true }], codePrefix:"PD" }),
  ev("EVF", "free-night", { ticketTypes:[{ id:"FG", name:"Guest", price:0 }, { id:"FM", name:"Member", price:0, needsMembership:true }], codePrefix:"FR" }),
  ev("EVC", "tiny-night", { capacity:1, ticketTypes:[{ id:"CG", name:"Guest", price:0 }], codePrefix:"TN" })
];
TBL.Orders = []; TBL.Tickets = [];
TBL.__members = [
  { memberId:"CSS0011234", name:"Mia Member", email:"mia@x.ca", ucid:"30111222", paid:true },
  { memberId:"CSS0022222", name:"Noah Other", email:"noah@x.ca", ucid:"30333444", paid:true },
  { memberId:"CSS0033333", name:"Pat Unpaid", email:"pat@x.ca", ucid:"30555666", paid:false }
];
// the real versions open Google Sheets: the in-memory tables stand in
var FAIL_TICKET_WRITES = 0;
function table_() {}
function insertRows_(name, objs) { if (FAIL_TICKET_WRITES > 0) { FAIL_TICKET_WRITES--; throw new Error("Service Spreadsheets timed out"); } objs.forEach(function (o) { insertRow_(name, o); }); }
function throttle_() {}
var __mail = [];
function sendRegistrationEmail_(event, order, tickets) { __mail.push("reg:" + order.code); return true; }
function sendPendingTicketEmails_(orderId) { __mail.push("tix:" + orderId); return { sent: 1, waiting: 0 }; }
function person(over) { return Object.assign({ name:"Alex Guest", email:"alex@x.ca", ticketTypeId:"TG", answers:{} }, over || {}); }
`);
const reg = (slug, people, extra) => run(`register_(${JSON.stringify(Object.assign({ slug, people }, extra || {}))})`);
const orders = () => run("TBL.Orders.length");
const cache = (k) => run(`CacheService.getScriptCache().remove(${JSON.stringify(k)})`);
const live = (orderId) => run(`TBL.Tickets.filter(function (t) { return t.orderId === ${JSON.stringify(orderId)}; })`);

// ---- Paid event: payment instructions plus each person's ticket page (payment status first)
const paid = reg("paid-night", [{ name: "Alex Guest", email: "alex@x.ca", ticketTypeId: "TG", answers: {} }, { name: "Friend One", email: "f1@x.ca", ticketTypeId: "TG", answers: {} }]);
ok(paid.ok && paid.order.status === "awaiting" && paid.order.total === 18 && paid.tickets.length === 2, "a paid registration with a friend: awaiting, $18, two tickets");
ok(paid.tickets.every((t) => /^ticket\.html\?t=[a-f0-9]{32}$/.test(t.page)), "each person gets a ticket page to check payment status on");
ok(paid.etransferEmail === "pay@css.test", "e-transfer address is in the reply");

// ---- Free event: tickets immediately, with their pages
const free = reg("free-night", [{ name: "Free Person", email: "free@x.ca", ticketTypeId: "FG", answers: {} }]);
ok(free.order.status === "paid" && free.needsReview === false && free.tickets[0].page.startsWith("ticket.html?t="), "a free registration is paid straight away and returns the ticket page");
ok(run("TBL.Tickets.filter(function (t) { return t.status === 'paid'; }).length") === 1 && run("__mail.indexOf('tix:' + TBL.Orders[1].id) !== -1"), "and the ticket email is sent");

// ---- Member verification
const KEY = run('linkKey_("pass", "CSS0011234")');
const viaPortal = reg("free-night", [{ ticketTypeId: "FM", answers: {} }], { member: { memberId: "CSS0011234", k: KEY } });
const t1 = viaPortal.ok && live(run("TBL.Orders[TBL.Orders.length - 1].id"))[0];
ok(viaPortal.ok && t1.name === "Mia Member" && t1.email === "mia@x.ca" && t1.memberId === "CSS0011234" && t1.ucid === "30111222", "from the portal (valid key) the details come from the Membership sheet");
ok(viaPortal.order.status === "paid" && t1.flag === "" && !viaPortal.needsReview, "and the free member ticket is issued at once, unflagged");

const spoof = reg("free-night", [{ name: "Zed Stranger", email: "zed@x.ca", ticketTypeId: "FM", memberId: "CSS0011234", answers: {} }]);
ok(spoof.needsReview === true && spoof.order.status === "awaiting" && /name doesn't match/.test(spoof.tickets[0].flag) && spoof.tickets[0].page === "", "someone else's member ID with a different name: flagged, held for review, no ticket yet");

const sameName = reg("free-night", [{ name: "Mia Member", email: "mia2@x.ca", ticketTypeId: "FM", memberId: "CSS0011234", answers: {} }]);
ok(sameName.order.status === "paid" && !sameName.needsReview, "a typed ID with the matching name still goes straight through (nothing new for honest members)");

const mixed = reg("free-night", [{ name: "Mia Member", email: "mia3@x.ca", ticketTypeId: "FM", memberId: "CSS0011234", ucid: "30333444", answers: {} }]);
ok(mixed.needsReview === true && /UCID/.test(mixed.tickets[0].flag), "a member ID with another member's UCID is flagged: " + mixed.tickets[0].flag);

const twoMembers = reg("free-night", [{ name: "Mia Member", email: "mia4@x.ca", ticketTypeId: "FM", ucid: "30333444", memberId: "CSS0033333", answers: {} }]);
ok(twoMembers.needsReview === true && /different members|doesn't match/.test(twoMembers.tickets[0].flag), "an ID and a UCID of two different members are flagged: " + twoMembers.tickets[0].flag);

const badKey = reg("free-night", [{ name: "Zed Stranger", email: "zed2@x.ca", ticketTypeId: "FM", memberId: "CSS0011234", answers: {} }], { member: { memberId: "CSS0011234", k: "not-the-key" } });
ok(badKey.needsReview === true, "a wrong key is just 'not verified': the typed ID is checked against the name");

const unpaid = reg("free-night", [{ name: "Pat Unpaid", email: "pat@x.ca", ticketTypeId: "FM", answers: {} }], { member: { memberId: "CSS0033333", k: run('linkKey_("pass", "CSS0033333")') } });
ok(unpaid.needsReview === true && /isn't paid/.test(unpaid.tickets[0].flag), "a verified member whose membership is unpaid is still flagged");

const guestOfMember = reg("free-night", [{ ticketTypeId: "FG", answers: {} }, { name: "Their Friend", email: "fr@x.ca", ticketTypeId: "FM", memberId: "CSS0011234", answers: {} }], { member: { memberId: "CSS0011234", k: KEY } });
ok(guestOfMember.needsReview === true && /name doesn't match/.test(guestOfMember.tickets[1].flag), "a member's friend can't borrow the member's ID: only the verified person is exempt");

// ---- A retry never makes a second order, even after the 10-minute cache is gone
const before = orders();
const first = reg("paid-night", [{ name: "Retry Person", email: "r@x.ca", ticketTypeId: "TG", answers: {} }], { requestId: "retry-aaaa-1111" });
cache("regreq_retry-aaaa-1111");   // as if ten minutes had passed
const again = reg("paid-night", [{ name: "Retry Person", email: "r@x.ca", ticketTypeId: "TG", answers: {} }], { requestId: "retry-aaaa-1111" });
ok(again.order.code === first.order.code && orders() === before + 1, "same requestId after the cache expired returns the same order (no duplicate)");
ok(run("TBL.Tickets.filter(function (t) { return t.email === 'r@x.ca'; }).length") === 1, "and still just one ticket");

// ---- Tickets could not be written: the order is closed, then the retry makes a clean one
run("FAIL_TICKET_WRITES = 1");
let err = null;
try { reg("paid-night", [{ name: "Unlucky Person", email: "u@x.ca", ticketTypeId: "TG", answers: {} }], { requestId: "fail-bbbb-2222" }); } catch (e) { err = e; }
ok(err && err.code === "TEMPORARY", "a failed ticket write tells the page to try again (TEMPORARY)");
ok(run("TBL.Orders.filter(function (o) { return o.requestId === 'fail-bbbb-2222'; }).every(function (o) { return o.status === 'cancelled' && /^registration failed/.test(o.notes); })"), "the half-written order is cancelled with a note, not left live");
const retried = reg("paid-night", [{ name: "Unlucky Person", email: "u@x.ca", ticketTypeId: "TG", answers: {} }], { requestId: "fail-bbbb-2222" });
ok(retried.ok && retried.order.status === "awaiting" && run("TBL.Orders.filter(function (o) { return o.requestId === 'fail-bbbb-2222' && o.status === 'awaiting'; }).length") === 1, "the retry creates one clean registration");
ok(run("TBL.Tickets.filter(function (t) { return t.email === 'u@x.ca' && t.status === 'awaiting'; }).length") === 1, "with exactly one live ticket");

// ---- The script stopped after writing the order and one of two tickets: the retry fills the gap
run(`insertRow_("Orders", { id:"ORHALF", code:"PD-9999", eventId:"EVP", payerName:"Half One", payerEmail:"h1@x.ca", etransferName:"", total:18, status:"awaiting", createdAt:"2026-10-01T00:00:00Z", notes:"", requestId:"half-cccc-3333" });
insertRow_("Tickets", { id:"TKTHALF01", secret:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", orderId:"ORHALF", eventId:"EVP", name:"Half One", email:"h1@x.ca", ucid:"", memberId:"", ticketType:"General", price:9, answers:{}, flag:"", status:"awaiting", checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt:"" });`);
const resumed = reg("paid-night", [{ name: "Half One", email: "h1@x.ca", ticketTypeId: "TG", answers: {} }, { name: "Half Two", email: "h2@x.ca", ticketTypeId: "TG", answers: {} }], { requestId: "half-cccc-3333" });
ok(resumed.order.code === "PD-9999" && resumed.tickets.length === 2, "an interrupted registration is resumed on the same order: " + JSON.stringify(resumed.order));
ok(live("ORHALF").length === 2 && live("ORHALF").filter((t) => t.email === "h1@x.ca").length === 1, "the missing ticket was added and the first was not doubled");

// ---- The event is read again inside the lock
const realIntake = ctx.withIntakeLock_;
ctx.withIntakeLock_ = (fn) => realIntake(() => { run(`TBL.Events[0].status = "closed"`); return fn(); });
err = null; const beforeClose = orders();
try { reg("paid-night", [{ name: "Late Person", email: "late@x.ca", ticketTypeId: "TG", answers: {} }]); } catch (e) { err = e; }
ok(err && err.code === "CLOSED" && orders() === beforeClose, "closed while waiting for the lock: refused, nothing written");
run(`TBL.Events[0].status = "published"`);
ctx.withIntakeLock_ = (fn) => realIntake(() => { run(`TBL.Events[0].ticketTypes[0].price = 12; TBL.Events[0].updatedAt = "2026-10-02T00:00:00Z"`); return fn(); });
const repriced = reg("paid-night", [{ name: "Price Person", email: "price@x.ca", ticketTypeId: "TG", answers: {} }]);
ok(repriced.order.total === 12, "edited while waiting for the lock: the current price is used (12, not 9)");
ctx.withIntakeLock_ = realIntake;

// ---- Free registrations take both locks (so Mark paid can't hand out the same last spot)
const taken = [];
ctx.LockService = { getScriptLock: () => ({ tryLock() { taken.push("script"); return true; }, releaseLock() {} }), getUserLock: () => ({ tryLock() { taken.push("intake"); return true; }, releaseLock() {} }) };
reg("free-night", [{ name: "Lock Free", email: "lf@x.ca", ticketTypeId: "FG", answers: {} }]);
ok(taken.join(",") === "intake,script", "a free registration takes the intake lock, then the main lock: " + taken.join(","));
taken.length = 0;
reg("paid-night", [{ name: "Lock Paid", email: "lp@x.ca", ticketTypeId: "TG", answers: {} }]);
ok(taken.join(",") === "intake", "an order that waits for payment only needs the intake lock: " + taken.join(","));

// ---- Capacity with free tickets
reg("tiny-night", [{ name: "First In", email: "first@x.ca", ticketTypeId: "CG", answers: {} }]);
err = null;
try { reg("tiny-night", [{ name: "Too Late", email: "late2@x.ca", ticketTypeId: "CG", answers: {} }]); } catch (e) { err = e; }
ok(err && err.code === "SOLD_OUT", "the last free spot goes to one person only");

// ---- Portal autofill and where ticket links go
const prof = run(`memberProfile_({ memberId: "CSS0011234", k: ${JSON.stringify(KEY)} })`);
ok(prof.ok && prof.member.name === "Mia Member" && prof.member.email === "mia@x.ca" && prof.member.ucid === "30111222", "a valid pass key returns the member's details for pre-filling");
err = null;
try { run('memberProfile_({ memberId: "CSS0011234", k: "wrong" })'); } catch (e) { err = e; }
ok(err && err.code === "NOT_ALLOWED", "a wrong key gets nothing");
ok(run('allTicketsLinkFor_("alex@x.ca")').indexOf("https://events.ucalgarycss.ca/tickets.html?e=alex%40x.ca&k=") === 0, "a guest's 'all my tickets' link stays on the event site");
const memberLink = run('allTicketsLinkFor_("mia@x.ca")');
ok(memberLink.indexOf("https://member.ucalgarycss.ca/?member=CSS0011234&k=") === 0 && /&view=tickets$/.test(memberLink), "a member's link opens their pass and tickets in the member portal");

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
