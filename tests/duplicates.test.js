// Duplicate people are stopped before writing an order; shared email addresses still work.
const { ctx, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (error) { return { error: error.code, message: error.message }; } };

run(`
function duplicateEvent(id, slug) {
  return { id:id, slug:slug, name:slug, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"TRUE", status:"published", entryOpen:"FALSE", ticketTypes:[{id:"TG",name:"General",price:9}], questions:[], codePrefix:id, archivedAt:"", summary:{}, updatedAt:"" };
}
TBL.Events = [duplicateEvent("EV1", "first-night"), duplicateEvent("EV2", "second-night")];
TBL.Orders = []; TBL.Tickets = []; TBL.Waitlist = [];
function table_() {}
function throttle_() {}
function insertRows_(name, objs) { objs.forEach(function (o) { insertRow_(name, o); }); }
function sendPendingTicketEmails_() { return { sent:0, waiting:0 }; }
function sendRegistrationEmail_() { return false; }
`);
const person = (extra) => Object.assign({ name: "Amadeus Test", email: "amadeus@example.com", ucid: "30111111", ticketTypeId: "TG", answers: {} }, extra || {});
const reg = (people, extra) => attempt("register_(" + JSON.stringify(Object.assign({ slug: "first-night", people }, extra || {})) + ")");
const counts = () => run("TBL.Orders.length + ':' + TBL.Tickets.length");

const first = reg([person()], { requestId: "first-registration-1111" });
ok(first.value && first.value.ok && counts() === "1:1", "the first signup creates one order and one ticket");
let reply = reg([person()], { requestId: "new-submission-2222" });
ok(reply.error === "ALREADY_REGISTERED" && counts() === "1:1", "a new submission for the same attendee creates no second order or ticket");
ok(/My tickets/.test(reply.message || ""), "the attendee is told how to find the existing ticket");

reply = reg([person({ email: "changed@example.com", name: "Different spelling" })]);
ok(reply.error === "ALREADY_REGISTERED" && counts() === "1:1", "the same UCID cannot get another ticket by changing name and email");
reply = reg([person({ name: "  AMADEUS   TEST ", email: "AMADEUS@EXAMPLE.COM", ucid: "30222222" })]);
ok(reply.error === "ALREADY_REGISTERED" && counts() === "1:1", "case and spacing changes to the same name and email cannot create another ticket");

run("CacheService.getScriptCache().remove('regreq_first-registration-1111'); CacheService.getScriptCache().remove('regreq_first-night_first-registration-1111')");
reply = reg([person()], { requestId: "first-registration-1111" });
ok(reply.value && reply.value.order.code === first.value.order.code && counts() === "1:1", "a genuine retry still returns its original ticket after the reply cache is gone");

const beforeGroup = counts();
reply = reg([person({ name: "Group Person", email: "group@example.com", ucid: "30333333" }), person({ name: "Group Person", email: "group@example.com", ucid: "30333333" })]);
ok(reply.error === "BAD_REQUEST" && /listed more than once/.test(reply.message) && counts() === beforeGroup, "a duplicate within a group is refused before the order is written");
reply = reg([person({ name: "Member One", email: "m1@example.com", ucid: "", memberId: "CSS0011234" }), person({ name: "Member Two", email: "m2@example.com", ucid: "", memberId: "css0011234" })]);
ok(reply.error === "BAD_REQUEST" && counts() === beforeGroup, "a member code cannot be reused for two people in the same group");

reply = reg([person({ name: "First Friend", email: "shared@example.com", ucid: "30444444" }), person({ name: "Second Friend", email: "shared@example.com", ucid: "30555555" })]);
ok(reply.value && reply.value.ok && reply.value.tickets.length === 2, "two different friends may share an email address");
reply = reg([person({ name: "Third Friend", email: "shared@example.com", ucid: "30666666" })]);
ok(reply.value && reply.value.ok && !reply.value.tickets[0].flag, "another different friend sharing that email is not treated as a duplicate");

reply = reg([person()], { slug: "second-night" });
ok(reply.value && reply.value.ok, "the same attendee can register for another event");
run("TBL.Tickets.filter(function(t){return t.eventId==='EV1' && t.ucid==='30111111';})[0].status='cancelled'");
reply = reg([person()]);
ok(reply.value && reply.value.ok, "a cancelled ticket does not stop someone registering again");
run("TBL.Tickets.filter(function(t){return t.eventId==='EV1' && t.ucid==='30111111' && t.status==='awaiting';})[0].status='refunded'");
reply = reg([person()]);
ok(reply.value && reply.value.ok, "a refunded ticket does not stop someone registering again");

// An intervening signup happens after the outside-lock snapshot but before this request takes the lock.
const realIntake = ctx.withIntakeLock_;
ctx.withIntakeLock_ = (fn) => realIntake(() => {
  run(`insertRow_("Tickets", {id:"TKTINTERVENING",orderId:"OTHER",eventId:"EV1",name:"Concurrent Person",email:"concurrent@example.com",ucid:"30777777",memberId:"",status:"paid"})`);
  return fn();
});
const beforeConcurrent = run("TBL.Orders.length");
reply = reg([person({ name: "Concurrent Person", email: "concurrent@example.com", ucid: "30777777" })]);
ctx.withIntakeLock_ = realIntake;
ok(reply.error === "ALREADY_REGISTERED" && run("TBL.Orders.length") === beforeConcurrent, "a signup that finishes while another waits for the lock is caught using fresh tickets");

ok(run("sameRegistrationPerson_({name:'Alex Chan',email:'family@example.com'},{name:'Taylor Chan',email:'family@example.com'})") === false, "a shared surname and email do not conflate different attendees");
ok(run("sameRegistrationPerson_({name:'',email:''},{name:'',email:''})") === false, "blank email addresses and names are never identities");

// The same request token is independent for each event, including after its short reply cache expires.
const crossPerson = person({ name: "Cross Event", email: "cross@example.com", ucid: "30888888" });
const crossFirst = reg([crossPerson], { requestId: "cross-event-request-3333" });
const crossSecond = reg([crossPerson], { slug: "second-night", requestId: "cross-event-request-3333" });
ok(crossFirst.value && crossSecond.value && crossFirst.value.order.code !== crossSecond.value.order.code, "a request ID reused for a different event never returns the first event's ticket");
run("CacheService.getScriptCache().remove('regreq_second-night_cross-event-request-3333')");
reply = reg([crossPerson], { slug: "second-night", requestId: "cross-event-request-3333" });
ok(reply.value && reply.value.order.code === crossSecond.value.order.code, "the saved retry lookup is scoped to the correct event too");

const closedPerson = person({ name: "Cancelled Retry", email: "cancelled@example.com", ucid: "30999999" });
const closed = reg([closedPerson], { requestId: "cancelled-request-4444" });
run("TBL.Orders.filter(function(o){return o.requestId==='cancelled-request-4444';})[0].status='cancelled'; TBL.Tickets.filter(function(t){return t.ucid==='30999999';}).forEach(function(t){t.status='cancelled'}); CacheService.getScriptCache().remove('regreq_first-night_cancelled-request-4444')");
const beforeClosedRetry = counts();
reply = reg([closedPerson], { requestId: "cancelled-request-4444" });
ok(closed.value && reply.error === "BAD_REQUEST" && /cancelled/.test(reply.message) && counts() === beforeClosedRetry, "retrying a cancelled order cannot resurrect it or add tickets");

const beforeManual = counts();
reply = attempt("addOrder_({name:'Finance'}, 'EV1', " + JSON.stringify({ person: person() }) + ", true, '')");
ok(reply.error === "ALREADY_REGISTERED" && counts() === beforeManual, "Finance cannot accidentally add a duplicate even when overriding capacity");
reply = attempt("walkIn_({name:'Door'}, 'EV1', " + JSON.stringify(Object.assign(person(), { method: "cash" })) + ")");
ok(reply.error === "ALREADY_REGISTERED" && counts() === beforeManual, "adding a walk-in cannot create a second ticket for an existing attendee");

run(`insertRow_("Waitlist", {id:"WLDUP",eventId:"EV1",name:"Amadeus Test",email:"amadeus@example.com",ucid:"30111111",memberId:"",ticketTypeId:"TG",answers:{},status:"waiting"})`);
reply = attempt("offerWaitlistSpot_({name:'Finance'}, 'WLDUP', true, '')");
ok(reply.error === "ALREADY_REGISTERED" && counts() === beforeManual && run("TBL.Waitlist[0].status") === "waiting", "a stale waitlist offer cannot add another ticket after the attendee has registered");

run("TBL.Events[0].capacity=1");
const waitPerson = person({ name: "Waitlist First", email: "wait-shared@example.com", ucid: "31111111" });
reply = attempt("joinWaitlist_(" + JSON.stringify({ slug: "first-night", person: waitPerson }) + ")");
ok(reply.value && !reply.value.already, "a new person may join the waitlist");
reply = attempt("joinWaitlist_(" + JSON.stringify({ slug: "first-night", person: person({ name: "Waitlist Second", email: "wait-shared@example.com", ucid: "31222222" }) }) + ")");
ok(reply.value && !reply.value.already, "two different waitlisted friends may share an email too");
const beforeWaitRetry = run("TBL.Waitlist.length");
reply = attempt("joinWaitlist_(" + JSON.stringify({ slug: "first-night", person: Object.assign({}, waitPerson, { email: "wait-new@example.com" }) }) + ")");
ok(reply.value && reply.value.already && run("TBL.Waitlist.length") === beforeWaitRetry, "changing email does not duplicate the same UCID on the waitlist");
reply = attempt("joinWaitlist_(" + JSON.stringify({ slug: "first-night", person: person({ email: "another-email@example.com" }) }) + ")");
ok(reply.error === "ALREADY_REGISTERED" && run("TBL.Waitlist.length") === beforeWaitRetry, "an existing ticket holder cannot join the waitlist using another email");

// A saved order with no ticket must not bypass the identity check when a later registration already has the spot.
run(`
TBL.Events[0].capacity = ""; TBL.Requests = []; TBL.Waitlist = [];
TBL.Orders = [{id:"HALFADD",eventId:"EV1",code:"EV1-HALFADD",payerName:"Recovery Person",payerEmail:"recovery@example.com",total:9,status:"paid",requestId:"add-recovery-add-5555",notes:""}];
TBL.Tickets = [{id:"COMPETINGADD",orderId:"OTHERADD",eventId:"EV1",name:"Recovery Person",email:"changed@example.com",ucid:"31333333",memberId:"",status:"paid",price:9}];
`);
const recoveryPerson = person({ name: "Recovery Person", email: "recovery@example.com", ucid: "31333333" });
const recoveryAdd = "addOrder_({name:'Finance'}, 'EV1', " + JSON.stringify({ person: recoveryPerson }) + ", true, '', 'recovery-add-5555')";
reply = attempt(recoveryAdd);
ok(reply.error === "ALREADY_REGISTERED" && counts() === "1:1" && run("TBL.Orders[0].status") === "paid", "resuming a half-saved Finance addition cannot duplicate a later active ticket or lose the saved payment");
run("TBL.Tickets[0].status='cancelled'");
reply = attempt(recoveryAdd);
ok(reply.value && reply.value.ok && counts() === "1:2" && run("TBL.Tickets[1].orderId") === "HALFADD", "once the competing ticket is cancelled, Finance safely finishes the original order");
reply = attempt(recoveryAdd);
ok(reply.value && reply.value.ok && counts() === "1:2", "repeating the recovered Finance request still creates no extra ticket");

run(`
TBL.Requests = [];
TBL.Orders = [{id:"HALFWL",eventId:"EV1",code:"EV1-HALFWL",payerName:"Recovery Person",payerEmail:"recovery@example.com",total:9,status:"awaiting",requestId:"wl-WLRECOVERY",notes:"",createdAt:"2026-11-20T00:00:00Z"}];
TBL.Tickets = [{id:"COMPETINGWL",orderId:"OTHERWL",eventId:"EV1",name:"Recovery Person",email:"changed@example.com",ucid:"31333333",memberId:"",status:"paid",price:9}];
TBL.Waitlist = [{id:"WLRECOVERY",eventId:"EV1",name:"Recovery Person",email:"recovery@example.com",ucid:"31333333",memberId:"",ticketTypeId:"TG",ticketType:"General",answers:{},status:"waiting"}];
`);
const recoveryOffer = "offerWaitlistSpot_({name:'Finance'}, 'WLRECOVERY', true, '', 'recovery-offer-6666')";
reply = attempt(recoveryOffer);
ok(reply.error === "ALREADY_REGISTERED" && counts() === "1:1" && run("TBL.Waitlist[0].status") === "waiting", "resuming a half-saved waitlist offer cannot duplicate a later active ticket or mark the entry offered");
run("TBL.Tickets[0].status='cancelled'");
reply = attempt(recoveryOffer);
ok(reply.value && reply.value.ok && counts() === "1:2" && run("TBL.Tickets[1].orderId") === "HALFWL" && run("TBL.Waitlist[0].status") === "offered", "once the competing ticket is cancelled, the waitlist offer safely finishes its original order");
reply = attempt(recoveryOffer);
ok(reply.value && reply.value.ok && counts() === "1:2", "repeating the recovered waitlist request still creates no extra ticket");

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
