const { ctx, sent, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const J = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || e.message, msg: e.message }; } };
const S = { name: "Exec" };

run(`
function table_() {}
function withIntakeLockFix_() {}
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", description:"", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"4",
  capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"FALSE", ticketTypes:[{id:"T0",name:"Free member",price:0,needsMembership:true},{id:"T2",name:"General",price:9,needsMembership:false}],
  questions:[], codePrefix:"MJ", registrationCloses:"", archivedAt:"", archiveYear:"", summary:{}, createdAt:"", updatedAt:"" }];
TBL.Orders = []; TBL.Tickets = []; TBL.Waitlist = []; TBL.Feedback = []; TBL.Emails = [];
TBL.__members = [{ memberId:"CSS0011234", name:"Mem Ber", email:"mem@x.ca", ucid:"12345678", paid:true, row:2 }];
`);

// ---- SEC-01: free member ticket with a fake member ID must not auto-issue
let r = J(`register_({ slug:"mj", people:[{ name:"Fake Member", email:"fake@x.ca", ticketTypeId:"T0", memberId:"CSS9999999", answers:{} }] })`);
ok(r.v && r.v.ok && r.v.order.status === "awaiting" && r.v.needsReview === true, "SEC-01: $0 flagged order stays awaiting + needsReview: " + JSON.stringify(r.v && r.v.order) + (r.err ? r.msg : ""));
ok(sent.length === 0, "SEC-01: no email/ticket is sent for the held order");
const heldOrder = run(`TBL.Orders[0]`);
ok(/Requires exec verification/.test(heldOrder.notes), "SEC-01: order note says it needs exec verification");
r = J(`register_({ slug:"mj", people:[{ name:"Mem Ber", email:"mem@x.ca", ucid:"12345678", memberId:"CSS0011234", ticketTypeId:"T0", answers:{} }] })`);
ok(r.v && r.v.order.status === "paid" && !r.v.needsReview, "SEC-01: a real paid member gets the free ticket straight away");

// ---- SEC-02: capacity 4, rule paid: hard stop at 4 paid, queue ceiling 5 (floor(4*1.25))
run(`TBL.Orders=[]; TBL.Tickets=[];`);
for (let i = 0; i < 5; i++) {
  r = J(`register_({ slug:"mj", people:[{ name:"Person ${i}", email:"p${i}@x.ca", ticketTypeId:"T2", answers:{} }] })`);
  ok(r.v && r.v.ok, "SEC-02: sign-up " + (i + 1) + " accepted (queue below ceiling)");
}
r = J(`register_({ slug:"mj", people:[{ name:"Person 6", email:"p6@x.ca", ticketTypeId:"T2", answers:{} }] })`);
ok(r.err === "SOLD_OUT" && /queue is full/i.test(r.msg), "SEC-02: sixth unpaid sign-up refused: " + r.msg);
run(`TBL.Tickets.forEach(function(t,i){ if(i<4) t.status="paid"; });`);
r = J(`register_({ slug:"mj", people:[{ name:"Late", email:"late@x.ca", ticketTypeId:"T2", answers:{} }] })`);
ok(r.err === "SOLD_OUT" && /full/i.test(r.msg), "SEC-02: hard cap once paid tickets reach capacity: " + r.msg);

// ---- Cancel request
run(`TBL.Orders=[]; TBL.Tickets=[];
insertRow_("Orders",{id:"OA",code:"MJ-1",eventId:"EV1",payerName:"Una",payerEmail:"u@x.ca",total:9,status:"awaiting",createdAt:"2026-10-01T00:00:00Z",notes:""});
insertRow_("Tickets",{id:"TKU",secret:"u".repeat(30),orderId:"OA",eventId:"EV1",name:"Una",email:"u@x.ca",ucid:"",memberId:"",ticketType:"General",price:9,answers:{},flag:"",status:"awaiting",checkedInAt:"",createdAt:"2026-10-01T00:00:00Z"});
insertRow_("Orders",{id:"OP",code:"MJ-2",eventId:"EV1",payerName:"Pam",payerEmail:"pam@x.ca",total:9,status:"paid",createdAt:"2026-10-01T00:00:00Z",notes:""});
insertRow_("Tickets",{id:"TKP",secret:"p".repeat(30),orderId:"OP",eventId:"EV1",name:"Pam",email:"pam@x.ca",ucid:"",memberId:"",ticketType:"General",price:9,answers:{},flag:"",status:"paid",checkedInAt:"",createdAt:"2026-10-01T00:00:00Z"});`);
let t = J(`getTicket_("${"u".repeat(30)}")`).v;
ok(t.canRequestCancel === true && t.cancelRequested === false && t.canGiveFeedback === false, "getTicket: unpaid ticket can ask to cancel");
r = J(`requestCancel_("${"u".repeat(30)}", false)`);
ok(r.v && r.v.cancelRequested === true, "request cancel ok");
t = J(`getTicket_("${"u".repeat(30)}")`).v;
ok(t.cancelRequested === true, "getTicket shows the request");
let lo = J(`listOrders_("EV1", {filter:"cancelreq"})`).v;
ok(lo.orders.length === 1 && lo.counts.cancelRequests === 1 && lo.orders[0].cancelRequestedBy === "Una", "Finance sees the request (filter + count)");
ok(run(`TBL.Orders[0].status`) === "awaiting", "nothing was cancelled by the request");
r = J(`requestCancel_("${"p".repeat(30)}", false)`);
ok(r.err === "BAD_REQUEST", "a paid ticket can't ask to cancel");
J(`requestCancel_("${"u".repeat(30)}", true)`);
ok(J(`getTicket_("${"u".repeat(30)}")`).v.cancelRequested === false, "undo clears the request");
J(`requestCancel_("${"u".repeat(30)}", false)`);
J(`dismissCancelRequest_(${JSON.stringify(S)}, "OA")`);
ok(J(`listOrders_("EV1", {filter:"cancelreq"})`).v.orders.length === 0, "Finance can dismiss the request");

// ---- Feedback
r = J(`submitFeedback_({ secret:"${"p".repeat(30)}", rating:5 })`);
ok(r.err === "BAD_REQUEST", "feedback refused before check-in");
run(`updateRow_("Tickets","TKP",{checkedInAt:"2099-01-01T19:00:00Z"})`);
t = J(`getTicket_("${"p".repeat(30)}")`).v;
ok(t.canGiveFeedback === true && t.feedback === null, "checked-in ticket can give feedback");
r = J(`submitFeedback_({ secret:"${"p".repeat(30)}", rating:4, comment:"=HYPERLINK(evil) Great night" })`);
ok(r.v && r.v.ok && r.v.feedback.rating === 4, "feedback saved");
ok(!/^[=+\-@]/.test(run(`TBL.Feedback[0].comment`)), "comment is sanitised against formulas: " + run(`TBL.Feedback[0].comment`));
r = J(`submitFeedback_({ secret:"${"p".repeat(30)}", rating:2, comment:"changed" })`);
ok(run(`TBL.Feedback.length`) === 1 && run(`TBL.Feedback[0].rating`) === 2, "rating again replaces (one per ticket)");
r = J(`submitFeedback_({ secret:"${"p".repeat(30)}", rating:9 })`);
ok(r.err === "BAD_REQUEST", "rating must be 1 to 5");
const fb = J(`feedbackSummary_("EV1")`).v;
ok(fb.count === 1 && fb.average === 2 && fb.comments.length === 1, "feedback summary");

// ---- Event report + member history
run(`TBL.Tickets.push(Object.assign({}, TBL.Tickets[1]));`);  // no-op duplicate shape check
run(`TBL.Tickets.pop();`);
run(`insertRow_("Orders",{id:"OM",code:"MJ-3",eventId:"EV1",payerName:"Mem Ber",payerEmail:"mem@x.ca",total:9,status:"paid",createdAt:"2026-10-02T10:00:00Z",notes:""});
insertRow_("Tickets",{id:"TKM",secret:"m".repeat(30),orderId:"OM",eventId:"EV1",name:"Mem Ber",email:"mem@x.ca",ucid:"12345678",memberId:"CSS0011234",ticketType:"General",price:9,answers:{},flag:"",status:"paid",checkedInAt:"2099-01-01T19:05:00Z",createdAt:"2026-10-02T10:00:00Z"});`);
const rep = J(`eventReport_(${JSON.stringify(S)}, "EV1")`);
ok(rep.v && rep.v.ok && rep.v.paidTickets === 2 && rep.v.members.members === 1 && rep.v.attendanceRate === 100, "event report numbers: " + JSON.stringify(rep.v && { paid: rep.v.paidTickets, members: rep.v.members, rate: rep.v.attendanceRate }) + (rep.err ? rep.msg : ""));
const h = J(`memberHistory_(${JSON.stringify(S)}, "CSS0011234")`);
ok(h.v && h.v.entries.length === 1 && h.v.attended === 1, "member history finds the member's ticket: " + JSON.stringify(h.v && { n: h.v.entries.length, attended: h.v.attended }) + (h.err ? h.msg : ""));
ok(J(`memberHistory_(${JSON.stringify(S)}, "NOPE")`).err === "NOT_FOUND", "history for unknown member: not found");

// ---- per-user lockout
run(`var __props = { password: "pw", adminPassword: "adm" }; getConfig_ = function(){ return { password:"pw", adminPassword:"adm", etransferEmail:"p@x" }; };`);
for (let i = 0; i < 30; i++) J(`login_("bad","Alice")`);
ok(J(`login_("bad","Alice")`).err === "TOO_MANY_TRIES", "lockout: Alice is locked after too many tries");
ok(J(`login_("pw","Bob")`).v && J(`login_("pw","Bob")`).v.ok, "lockout: Bob is NOT locked by Alice's bad passwords");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
