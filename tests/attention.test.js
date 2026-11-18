// Needs attention: payments to check, refunds owed, ticket emails not sent, waitlist offers and membership cards not delivered,
// from every live event, and the buttons that deal with each (Done, Send now, Resend offer, Resend card).
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || "ERROR", msg: e.message }; } };

run(`
function withLock_(f) { return f(); }
function withIntakeLock_(f) { return f(); }
function table_() {}
var __regMail = true, __cardMail = true, __cells = [];
function sendRegistrationEmail_() { return __regMail; }
function sendMemberWelcomeEmail_() { return __cardMail; }
function openMemberSheet_() { return { members: TBL.__members }; }
function setMemberCells_(book, m, changes) { __cells.push([m.memberId, changes]); Object.assign(m, changes); }
var S = { name: "TEST Finance", role: "exec" };
function ev(id, extra) { return Object.assign({ id:id, slug:id.toLowerCase(), name:"TEST " + id, date:"2099-01-01", status:"published", ticketTypes:[{ id:"G", name:"General", price:10 }], questions:[], archivedAt:"", summary:{}, mailTickets:"TRUE" }, extra || {}); }
function seed() {
  TBL.Events = [ev("EV1"), ev("EVD", { status:"draft" }), ev("EVA", { status:"archived", archivedAt:"2026-01-01" }), ev("EVO", { mailTickets:"FALSE" })];
  TBL.Orders = [
    { id:"O1", code:"T-1", eventId:"EV1", status:"awaiting", total:10, received:"0" },
    { id:"O2", code:"T-2", eventId:"EV1", status:"paid", total:10 },
    { id:"O3", code:"T-3", eventId:"EV1", status:"awaiting", total:10 },
    { id:"OA", code:"A-1", eventId:"EVA", status:"paid", total:10 }
  ];
  TBL.Tickets = [
    { id:"K1", orderId:"O2", eventId:"EV1", status:"paid", emailedAt:"" },
    { id:"K2", orderId:"O2", eventId:"EV1", status:"paid", emailedAt:"2026-11-01T00:00:00Z" },
    { id:"K3", orderId:"O3", eventId:"EV1", status:"awaiting", emailedAt:"" },
    { id:"KD", orderId:"OD", eventId:"EVD", status:"paid", emailedAt:"" },
    { id:"KO", orderId:"OO", eventId:"EVO", status:"paid", emailedAt:"" }
  ];
  TBL.Refunds = [
    { id:"RF1", orderId:"O2", eventId:"EV1", status:"owed", owed:10, returns:[{ amount:4 }] },
    { id:"RF2", orderId:"O2", eventId:"EV1", status:"owed", owed:5, returns:[{ amount:5 }] },   // fully returned: not on the list
    { id:"RFA", orderId:"OA", eventId:"EVA", status:"owed", owed:7, returns:[] }                // archived event: not on the list
  ];
  TBL.Waitlist = [
    { id:"W1", eventId:"EV1", name:"TEST Wally", status:"offered", orderId:"O3", orderCode:"T-3", offerEmail:"failed:2026-11-18T00:00:00Z" },
    { id:"W2", eventId:"EV1", name:"TEST Sent", status:"offered", orderId:"O1", orderCode:"T-1", offerEmail:"sent:2026-11-18T00:00:00Z" },
    { id:"W3", eventId:"EV1", name:"TEST Old", status:"offered", orderId:"O1", orderCode:"T-1", offerEmail:"" }   // before tracking: not guessed
  ];
  TBL.Requests = [
    { id:"applyTransfer:abc12345", action:"applyTransfer", who:"TEST Finance", status:"done", plan:{}, createdAt:new Date().toISOString(), doneAt:new Date().toISOString(),
      reply:{ ok:false, error:"NEEDS_REVIEW", conflicts:["O1"], message:"x" } },
    { id:"applyTransfer:old12345", action:"applyTransfer", who:"TEST Finance", status:"done", plan:{}, createdAt:"2025-01-01T00:00:00Z", doneAt:"2025-01-01T00:00:00Z",
      reply:{ ok:false, error:"NEEDS_REVIEW", conflicts:["O1"] } },
    { id:"applyTransfer:fine1234", action:"applyTransfer", who:"TEST Finance", status:"done", plan:{}, createdAt:new Date().toISOString(), doneAt:new Date().toISOString(), reply:{ ok:true } }
  ];
  TBL.__members = [
    { memberId:"CSS001", name:"TEST Pending Paid", email:"p@example.com", paid:true, mailStatus:"Pending" },
    { memberId:"CSS002", name:"TEST Sent Paid", email:"s@example.com", paid:true, mailStatus:"Sent" },
    { memberId:"CSS003", name:"TEST Old Paid", email:"o@example.com", paid:true, mailStatus:"" },
    { memberId:"CSS004", name:"TEST Unpaid", email:"u@example.com", paid:false, mailStatus:"Pending" }
  ];
}
seed();
`);
const list = () => run("attentionList_().items");
const kinds = (k) => list().filter((x) => x.kind === k);

let review = kinds("review");
ok(review.length === 1 && review[0].codes[0] === "T-1" && review[0].eventName === "TEST EV1" && review[0].what === "payment", "A payment that needs checking is listed with its order code (an old one and a normal one aren't)");
let refunds = kinds("refunds");
ok(refunds.length === 1 && refunds[0].count === 1 && Number(refunds[0].amount) === 6, "Refunds owed: only what's still to return ($6 of $10), not fully returned ones or archived events");
let emails = kinds("emails");
ok(emails.length === 1 && emails[0].eventId === "EV1" && emails[0].count === 1, "Unsent ticket emails: paid tickets only, not drafts, not events that don't email tickets");
let offers = kinds("offer");
ok(offers.length === 1 && offers[0].id === "W1" && offers[0].code === "T-3", "Waitlist offers: only the one whose email failed (not sent ones, not ones from before tracking)");
let cards = kinds("card");
ok(cards.length === 1 && cards[0].id === "CSS001", "Membership cards: paid members whose card is still Pending (not Sent, not blank old rows, not unpaid)");

// ---- The buttons
ok(fn(`dismissReview_(S, "applyTransfer:abc12345")`).v.ok && kinds("review").length === 0, "Done takes the payment check off the list");
ok(run(`TBL.Requests[0].status`) === "reviewed" && run(`TBL.Requests[0].reply.error`) === "NEEDS_REVIEW", "…and keeps the saved answer, so the old press still can't repeat");
ok(fn(`dismissReview_(S, "nope")`).err === "NOT_FOUND", "Done on something no longer there says so");

run(`__regMail = false;`);
let r = fn(`resendWaitlistOffer_(S, "W1")`);
ok(r.v && r.v.ok && r.v.emailed === false && kinds("offer").length === 1, "Resend offer that fails again: says so, and the offer stays on the list");
run(`__regMail = true;`);
r = fn(`resendWaitlistOffer_(S, "W1")`);
ok(r.v && r.v.emailed === true && kinds("offer").length === 0 && /^sent:/.test(run(`TBL.Waitlist[0].offerEmail`)), "Resend offer that works: leaves the list, noted as sent");
ok(fn(`resendWaitlistOffer_(S, "W9")`).err === "NOT_FOUND", "Resend offer for an offer that's gone says so");
run(`TBL.Orders[2].status = "paid";`);
ok(fn(`resendWaitlistOffer_(S, "W1")`).err === "BAD_REQUEST", "Resend offer once it's been paid is refused (nothing to pay any more)");

run(`__cardMail = false;`);
r = fn(`resendMemberCard_(S, "CSS001")`);
ok(r.err === "EMAIL_FAILED" && kinds("card").length === 1, "Resend card that fails again: says so, stays on the list");
run(`__cardMail = true;`);
r = fn(`resendMemberCard_(S, "CSS001")`);
ok(r.v && r.v.ok && kinds("card").length === 0, "Resend card that works: marked Sent, leaves the list");

// ---- The membership sheet can't be read: say so instead of looking all clear
run(`var realLoad = loadMembers_; loadMembers_ = function () { throw new Error("TEST sheet"); };`);
ok(kinds("membersUnreadable").length === 1, "If the membership sheet can't be read, the list says cards weren't checked");
run(`loadMembers_ = realLoad;`);

// ---- A waitlist offer records whether its email went out (so a failed one shows up)
run(`TBL.Waitlist.push({ id:"W5", eventId:"EV1", name:"TEST New", status:"offered", orderId:"O1", orderCode:"T-1", offerEmail:"" });`);
run(`recordOfferEmail_({ id: "W5" }, false);`);
ok(/^failed:/.test(run(`TBL.Waitlist.filter(function (w) { return w.id === "W5"; })[0].offerEmail`)) && kinds("offer").some((x) => x.id === "W5"), "A failed offer email is written down and appears in Needs attention");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
