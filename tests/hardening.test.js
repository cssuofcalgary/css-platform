// Event input validation, questions with the same wording, and the separate paid-ticket count.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

const base = { name: "Night", date: "2099-05-05", startTime: "18:00", endTime: "21:00", location: "MSC", capacity: "", capacityRule: "paid", ticketTypes: [{ name: "General", price: 5 }], questions: [] };
const clean = (over) => {
  try { return { ok: run("cleanEventInput_(" + JSON.stringify(Object.assign({}, base, over)) + ")") }; }
  catch (e) { return { error: e.code, message: e.message }; }
};
const bad = (over) => { const r = clean(over); return r.error === "BAD_REQUEST" ? r.message : ""; };

ok(clean({}).ok && clean({}).ok.capacity === "", "a normal event with a blank capacity saves, with no limit");
ok(clean({ capacity: "40" }).ok.capacity === 40, "a real capacity saves");
ok(bad({ capacity: "abc" }) !== "", "capacity that isn't a number is refused (it used to become 0 = unlimited)");
ok(bad({ capacity: "0" }) !== "", "capacity 0 is refused");
ok(bad({ capacity: "-5" }) !== "", "a negative capacity is refused");
ok(bad({ capacity: "Infinity" }) !== "", "an infinite capacity is refused");

ok(bad({ date: "2099-02-31" }) !== "", "a date that is not on the calendar is refused: " + bad({ date: "2099-02-31" }));
ok(bad({ date: "2099-13-01" }) !== "", "month 13 is refused");
ok(clean({ date: "2100-02-28" }).ok && !bad({ date: "2096-02-29" }), "real dates, including a leap day, are fine");
ok(bad({ startTime: "25:00" }) !== "" && bad({ endTime: "9pm" }) !== "", "times that aren't hours and minutes are refused");

ok(bad({ ticketTypes: [{ name: "G", price: "Infinity" }] }) !== "", "an infinite price is refused");
ok(bad({ ticketTypes: [{ name: "G", price: "-1" }] }) !== "", "a negative price is refused");
ok(bad({ ticketTypes: [{ name: "G", price: 5000 }] }) !== "", "an absurd price is refused");
ok(clean({ ticketTypes: [{ name: "Free", price: 0 }, { name: "Plus", price: 12.5 }] }).ok, "free and ordinary prices are fine");

ok(/worded the same/.test(bad({ questions: [{ label: "Meal", type: "text" }, { label: "meal ", type: "text" }] })), "two questions with the same wording are refused when saving");
ok(clean({ questions: [{ label: "Meal", type: "text" }, { label: "Allergies", type: "text" }] }).ok, "different wording is fine");

// ---- Older events that already have two questions worded alike keep both answers
run(`
var oldEvent = { id:"EV", name:"Old", ticketTypes:[{ id:"T", name:"G", price:0 }], questions:[
  { id:"q1", label:"Meal", type:"text", options:[], required:false }, { id:"q2", label:"Meal", type:"text", options:[], required:false }, { id:"q3", label:"Meal", type:"text", options:[], required:false }] };
`);
const person = run('cleanPerson_({ name: "A B", email: "a@x.ca", ticketTypeId: "T", answers: { q1: "Veg", q2: "Chicken", q3: "Fish" } }, oldEvent, 0)');
ok(person.answers.Meal === "Veg" && person.answers["Meal (2)"] === "Chicken" && person.answers["Meal (3)"] === "Fish", "same-worded questions on an existing event each keep their own answer: " + JSON.stringify(person.answers));

// ---- Paid-ticket count is separate from places taken
run(`
TBL.Events = [{ id:"EV1", slug:"c", name:"Cap", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:6, capacityRule:"all", waitlist:"FALSE", status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"CP", archivedAt:"", summary:{} }];
TBL.Orders = [{ id:"O1", code:"CP-1", eventId:"EV1", payerName:"P", total:5, status:"paid", createdAt:"2026-10-01T00:00:00Z" }, { id:"O2", code:"CP-2", eventId:"EV1", payerName:"Q", total:15, status:"awaiting", createdAt:"2026-10-01T00:00:00Z" }];
TBL.Tickets = [];
["paid","paid","paid","awaiting","awaiting","awaiting"].forEach(function (s, i) { insertRow_("Tickets", { id:"TKT" + i, secret:"s" + i, orderId: i < 3 ? "O1" : "O2", eventId:"EV1", name:"N" + i, email:"", ucid:"", memberId:"", ticketType:"G", price:5, answers:{}, flag:"", status:s, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt:"" }); });
`);
const list = run('listOrders_("EV1", {})');
ok(list.spotsTaken === 6 && list.paidTickets === 3, "capacity counts all sign-ups (6 places taken) but only 3 tickets are paid: " + list.spotsTaken + " / " + list.paidTickets);

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
