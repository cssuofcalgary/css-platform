const { ctx, sent, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const J = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || e.message, msg: e.message }; } };

run(`
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", description:"", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"2",
  capacityRule:"paid", waitlist:"TRUE", status:"published", entryOpen:"FALSE", ticketTypes:[{id:"T1",name:"Member",price:4,needsMembership:true},{id:"T2",name:"General",price:9,needsMembership:false}],
  questions:[{id:"Q1",label:"Drink",type:"choice",options:["Tea","Taro"],required:true}], codePrefix:"MJ", registrationCloses:"", archivedAt:"", archiveYear:"", summary:{}, createdAt:"", updatedAt:"" }];
TBL.Orders = []; TBL.Tickets = []; TBL.Waitlist = []; TBL.Feedback = []; TBL.Emails = [];
TBL.__members = [{ memberId:"CSS0011234", name:"Mem Ber", email:"mem@x.ca", ucid:"12345678", paid:true, row:2 }];
function mkOrder(id, status, n) { insertRow_("Orders", {id:id, code:"MJ-"+id, eventId:"EV1", payerName:"P"+id, payerEmail:id+"@x.ca", total:9, status:status, createdAt:"2026-10-01T00:00:00Z", notes:""});
  for (var i=0;i<n;i++) insertRow_("Tickets", {id:"TK"+id+i, secret:("s"+id+i+"0000000000000000000000").slice(0,30), orderId:id, eventId:"EV1", name:"N"+id+i, email:id+i+"@x.ca", ucid:"", memberId:"", ticketType:"General", price:9, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z"}); }
mkOrder("A","paid",1); mkOrder("B","paid",1);
`);

// ---- 1. event is full -> waitlist offered on the public view
let v = J(`publicEvent_("mj")`).v.event;
ok(v.soldOut === true, "public view: sold out when paid tickets reach capacity");
ok(v.waitlistOpen === true, "public view: waitlistOpen");

// ---- 2. join
let r = J(`joinWaitlist_({ slug:"mj", person:{ name:"Wendy Wait", email:"wendy@x.ca", ucid:"30111111", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
ok(r.v && r.v.ok && !r.v.already, "join waitlist ok");
ok(sent.length === 1 && /waitlist/i.test(sent[0].subject), "join sends one waitlist email: " + (sent[0] && sent[0].subject));
r = J(`joinWaitlist_({ slug:"mj", person:{ name:"Wendy Wait", email:"wendy@x.ca", ucid:"30111111", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
ok(r.v && r.v.already === true && sent.length === 1, "joining twice says already and sends no second email");
r = J(`joinWaitlist_({ slug:"mj", person:{ name:"Missing Drink", email:"md@x.ca", ucid:"30222222", ticketTypeId:"T2", answers:{} } })`);
ok(r.err === "BAD_REQUEST", "required question enforced on the waitlist form");
r = J(`joinWaitlist_({ slug:"mj", person:{ name:"NA0", email:"A0@x.ca", ucid:"30333333", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
ok(r.err === "ALREADY_REGISTERED", "someone with a ticket can't join the waitlist");
J(`joinWaitlist_({ slug:"mj", person:{ name:"Mem Ber", email:"mem@x.ca", ucid:"12345678", memberId:"CSS0011234", ticketTypeId:"T1", answers:{Q1:"Taro"} } })`);

// ---- 3. list
let l = J(`listWaitlist_("EV1")`).v;
ok(l.entries.length === 2 && l.entries[0].position === 1 && l.entries[1].position === 2, "list in sign-up order with positions");
ok(l.free === 0, "no free spots while event is full (free=" + l.free + ")");

// ---- 4. offer needs room
const sess = { name: "Finance" };
r = J(`offerWaitlistSpot_(${JSON.stringify(sess)}, "${l.entries[0].id}", false, "")`);
ok(r.err === "OVER_CAPACITY", "offer refused when no spot is free");

// a refund frees a spot
run(`updateRow_("Orders","B",{status:"refunded"}); updateRow_("Tickets","TKB0",{status:"refunded"});`);
l = J(`listWaitlist_("EV1")`).v;
ok(l.free === 1, "after a refund one spot is free (free=" + l.free + ")");
const before = sent.length;
r = J(`offerWaitlistSpot_(${JSON.stringify(sess)}, "${l.entries[0].id}", false, "")`);
ok(r.v && r.v.ok && r.v.status === "awaiting" && r.v.emailed === true, "offer creates an awaiting order and emails the registration: " + JSON.stringify(r));
ok(sent.length === before + 1 && /Registration received/i.test(sent[sent.length - 1].subject), "registration email subject: " + sent[sent.length - 1].subject);
const ord = run(`TBL.Orders.filter(function(o){return o.payerEmail==="wendy@x.ca"})[0]`);
ok(ord && ord.total === 9 && ord.status === "awaiting", "order has the right total/status");
l = J(`listWaitlist_("EV1")`).v;
ok(l.entries[0].status === "offered" && l.entries[0].orderCode === ord.code, "entry marked offered with order code");
ok(l.free === 0, "outstanding offer holds the spot (free=" + l.free + ")");
r = J(`offerWaitlistSpot_(${JSON.stringify(sess)}, "${l.entries[1].id}", false, "")`);
ok(r.err === "OVER_CAPACITY", "second offer refused while the first is unpaid");
r = J(`offerWaitlistSpot_(${JSON.stringify(sess)}, "${l.entries[0].id}", true, "")`);
ok(r.err === "BAD_REQUEST", "can't offer someone twice");

// force + member $4 type (member is paid -> no flag)
r = J(`offerWaitlistSpot_(${JSON.stringify(sess)}, "${l.entries[1].id}", true, "")`);
ok(r.v && r.v.ok && r.v.status === "awaiting", "forced offer works for a member ticket");
const mt = run(`TBL.Tickets.filter(function(t){return t.email==="mem@x.ca"})[0]`);
ok(mt && mt.flag === "" && mt.price === 4, "member ticket has no flag and member price");

// remove
J(`joinWaitlist_({ slug:"mj", person:{ name:"Zed", email:"zed@x.ca", ucid:"30444444", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
const zed = J(`listWaitlist_("EV1")`).v.entries.filter((e) => e.email === "zed@x.ca")[0];
r = J(`removeWaitlistEntry_(${JSON.stringify(sess)}, "${zed.id}")`);
ok(r.v && r.v.ok && J(`listWaitlist_("EV1")`).v.entries.every((e) => e.email !== "zed@x.ca"), "remove hides the entry");

// summary on listOrders
const lo = J(`listOrders_("EV1", {filter:"all"})`);
ok(lo.v && lo.v.waitlist && lo.v.waitlist.enabled === true, "listOrders carries the waitlist summary: " + JSON.stringify(lo.v && lo.v.waitlist) + (lo.err ? " ERR " + lo.msg : ""));

// someone who registered the normal way after joining the waitlist is never offered a second ticket
J(`joinWaitlist_({ slug:"mj", person:{ name:"Late Larry", email:"larry@x.ca", ucid:"30666666", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
let larry = J(`listWaitlist_("EV1")`).v.entries.filter((e) => e.email === "larry@x.ca")[0];
ok(larry && larry.hasTicket === false && larry.position > 0, "a new waitlist entry has no ticket yet and gets a place");
run(`insertRow_("Tickets", { id:"TKLARRY", secret:"larrysecret00000000000000000000", orderId:"OL", eventId:"EV1", name:"Late Larry", email:"Larry@X.ca", ucid:"", memberId:"", ticketType:"General", price:9, answers:{}, flag:"", status:"awaiting", checkedInAt:"", createdAt:"2026-10-02T00:00:00Z" });`);
larry = J(`listWaitlist_("EV1")`).v.entries.filter((e) => e.email === "larry@x.ca")[0];
ok(larry.hasTicket === true && larry.position === 0, "once they register (any capitals in the email) the list says so and they lose their place");
const friendJoin = J(`joinWaitlist_({ slug:"mj", person:{ name:"Larry's Friend", email:"larry@x.ca", ucid:"30777777", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
const friendEntry = J(`listWaitlist_("EV1")`).v.entries.find((e) => e.ucid === "30777777");
ok(friendJoin.v && friendEntry && !friendEntry.hasTicket && friendEntry.position > 0, "a different friend sharing the email keeps their waitlist place");
const larryOrders = () => run(`TBL.Orders.filter(function(o){ return o.payerEmail === "larry@x.ca"; }).length`);
const mailsBefore = sent.length;
r = J(`offerWaitlistSpot_(${JSON.stringify(sess)}, "${larry.id}", true, "")`);
ok(r.err === "ALREADY_REGISTERED" && /already has a ticket/.test(r.msg), "Offer a spot is refused, even when forced: " + r.msg);
ok(larryOrders() === 0 && sent.length === mailsBefore, "no second order and no payment email");
ok(run(`TBL.Waitlist.filter(function(w){ return w.email === "larry@x.ca"; })[0].status`) === "waiting", "the entry stays on the list for Finance to remove");
const summary = run(`waitlistSummary_(TBL.Events[0])`);
ok(summary.waiting === run(`TBL.Waitlist.filter(function(w){ return w.status === "waiting" && w.id !== "${larry.id}"; }).length`), "the Payments waitlist count leaves only the ticket holder out");
run(`updateRow_("Tickets", "TKLARRY", { status: "cancelled" });`);
larry = J(`listWaitlist_("EV1")`).v.entries.filter((e) => e.email === "larry@x.ca")[0];
ok(larry.hasTicket === false, "if that ticket is cancelled they can be offered a spot again");

// waitlist off -> join refused
run(`TBL.Events[0].waitlist = "FALSE"`);
r = J(`joinWaitlist_({ slug:"mj", person:{ name:"No Wl", email:"nw@x.ca", ucid:"30555555", ticketTypeId:"T2", answers:{Q1:"Tea"} } })`);
ok(r.err === "BAD_REQUEST", "join refused when the event has no waitlist");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
