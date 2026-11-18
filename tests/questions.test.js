// Questions for some ticket types only ("Which drink?" only on With-drink tickets), and walk-ins at the door:
// they must choose a ticket, are asked the same questions as a sign-up, and a free walk-in needs no payment method.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const tryRun = (code) => { try { return { ok: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };

run(`
function withLock_(fn) { return fn(); }
function withIntakeLock_(fn) { return fn(); }
function withIntakeAndScriptLock_(fn) { return fn(); }
function table_() {}
function insertRows_(name, objs) { objs.forEach(function (o) { insertRow_(name, o); }); }
function throttle_() {}
function sendRegistrationEmail_() { return true; }
function sendPendingTicketEmails_() { return { sent: 0, waiting: 0 }; }
function emailsAfterSave_() { return { sent: 0, waiting: 0 }; }
var DRINK = { id:"QD", label:"Which drink would you like?", type:"choice", options:["Milk tea","Mango tea"], required:true, forTickets:["WD","WM"] };
var NOTE = { id:"QN", label:"Allergies", type:"text", options:[], required:false };   // an older question: no forTickets at all
function ev(id, slug, extra) {
  return Object.assign({ id:id, slug:slug, name:"Event " + id, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
    status:"published", entryOpen:"TRUE", ticketTypes:[], questions:[], codePrefix:"EV", archivedAt:"", summary:{}, updatedAt:"2026-10-01T00:00:00Z" }, extra || {});
}
TBL.Events = [
  ev("EVT", "tiles", { codePrefix:"TT", ticketTypes:[
      { id:"WM", name:"With drink (Member)", price:3, needsMembership:true }, { id:"WD", name:"With drink", price:8 },
      { id:"ND", name:"No drink", price:5 }, { id:"NM", name:"No drink (Member)", price:0, needsMembership:true }],
    questions:[DRINK, NOTE] }),
  ev("EVO", "old-night", { codePrefix:"OL", ticketTypes:[{ id:"G", name:"General", price:5 }, { id:"F", name:"Free", price:0 }],
    questions:[{ id:"QM", label:"Meal", type:"choice", options:["Veg","Fish"], required:true }] })
];
TBL.Orders = []; TBL.Tickets = [];
TBL.__members = [{ memberId:"CSS0011234", name:"Mia Member", email:"mia@x.ca", ucid:"30111222", paid:true }];
var SESSION = { name:"Desk", role:"exec", sid:"s1" };
`);
const reg = (people) => tryRun(`register_(${JSON.stringify({ slug: "tiles", people })})`);
const lastTicket = () => run("TBL.Tickets[TBL.Tickets.length - 1]");

// ---- The event read carries forTickets on every question
const pub = run('publicEvent_("tiles")').event;
ok(JSON.stringify(pub.questions[0].forTickets) === '["WD","WM"]', "the public event read includes forTickets on the drink question");
ok(Array.isArray(pub.questions[1].forTickets) && pub.questions[1].forTickets.length === 0, "an older question with no list reads as [] (for every ticket)");
const execRead = run('findEvent_(function (e) { return e.id === "EVT"; })');
ok(JSON.stringify(execRead.questions[0].forTickets) === '["WD","WM"]', "the exec event read includes it too");
const door = run('doorList_("EVT", SESSION, {})');
ok(door.event.questions.length === 2 && door.event.questions[0].forTickets.length === 2, "the help desk's door list gets the questions (for the walk-in form)");
ok(run('doorList_("EVT", { name:"V", role:"door" }, {})').event.questions.length === 0, "a door volunteer's list does not");

// ---- Saving an event: forTickets is cleaned
const base = { name: "Night", date: "2099-05-05", ticketTypes: [{ id: "A", name: "With drink", price: 5 }, { id: "B", name: "No drink", price: 3 }] };
const saved = run(`cleanEventInput_(${JSON.stringify(Object.assign({}, base, { questions: [
  { label: "Drink", type: "choice", options: ["Tea", "Coffee"], required: true, forTickets: ["A", "GONE", "A"] },
  { label: "Notes", type: "text" }] }))})`);
ok(JSON.stringify(saved.questions[0].forTickets) === '["A"]', "unknown and repeated ticket ids are dropped when saving: " + JSON.stringify(saved.questions[0].forTickets));
ok(JSON.stringify(saved.questions[1].forTickets) === "[]", "a question without a list is saved for every ticket");
const deleted = run(`eventFromRow_({ ticketTypes: [{ id: "B", name: "No drink", price: 3 }], questions: ${JSON.stringify(saved.questions)} })`);
ok(deleted.questions[0].forTickets.length === 0, "when a ticket type is deleted, its id disappears from the question's list");

// ---- Sign-ups: shown and required only for matching tickets
let r = reg([{ name: "Wes Drink", email: "wes@x.ca", ticketTypeId: "WD", answers: {} }]);
ok(r.error === "BAD_REQUEST" && /Which drink/.test(r.message), "a With-drink ticket without a drink choice is refused: " + r.message);
r = reg([{ name: "Wes Drink", email: "wes@x.ca", ticketTypeId: "WD", answers: { QD: "Mango tea", QN: "nuts" } }]);
ok(r.ok && r.ok.ok, "with a drink chosen it goes through");
ok(lastTicket().answers["Which drink would you like?"] === "Mango tea" && lastTicket().answers.Allergies === "nuts", "and the drink and the for-everyone answer are saved on the ticket");
r = reg([{ name: "Nora Nodrink", email: "nora@x.ca", ticketTypeId: "ND", answers: { QN: "none" } }]);
ok(r.ok && r.ok.ok, "a No-drink ticket doesn't need the drink question");
r = reg([{ name: "Nick Nodrink", email: "nick@x.ca", ticketTypeId: "ND", answers: { QD: "Milk tea", QN: "gluten" } }]);
const nick = lastTicket();
ok(r.ok && nick.answers["Which drink would you like?"] === undefined && nick.answers.Allergies === "gluten", "a drink answer sent for a No-drink ticket is dropped, not saved: " + JSON.stringify(nick.answers));
r = reg([{ name: "Pay Er", email: "payer@x.ca", ticketTypeId: "ND", answers: {} }, { name: "Fr Iend", email: "friend@x.ca", ticketTypeId: "WD", answers: {} }]);
ok(r.error === "BAD_REQUEST" && /Fr Iend/.test(r.message), "per person: a friend on a With-drink ticket still has to choose, even when the payer has no drink");

// ---- Old events with no forTickets behave as before
const oldReg = (p) => tryRun(`register_(${JSON.stringify({ slug: "old-night", people: [p] })})`);
r = oldReg({ name: "Old One", email: "old1@x.ca", ticketTypeId: "F", answers: {} });
ok(r.error === "BAD_REQUEST" && /Meal/.test(r.message), "an older event's required question is still required for every ticket type");
r = oldReg({ name: "Old Two", email: "old2@x.ca", ticketTypeId: "F", answers: { QM: "Fish" } });
ok(r.ok && lastTicket().answers.Meal === "Fish", "and saved as before");

// ---- Finance "Add registration": answers that don't apply are dropped too (required stays optional there, as before)
const added = tryRun(`addOrder_(SESSION, "EVT", { person: { name: "Ann Added", email: "ann@x.ca", ticketTypeId: "ND", answers: { QD: "Milk tea" } } }, true, "")`);
ok(added.ok && added.ok.ok && JSON.stringify(lastTicket().answers) === "{}", "Finance add drops a drink answer on a No-drink ticket");

// ---- Walk-ins
const walk = (input) => tryRun(`walkIn_(SESSION, "EVT", ${JSON.stringify(input)})`);
const before = run("TBL.Tickets.length");
r = walk({ name: "No Choice", method: "cash", answers: {} });
ok(r.error === "BAD_REQUEST" && /ticket type/i.test(r.message) && run("TBL.Tickets.length") === before, "a walk-in with no ticket type chosen is refused and nothing is saved");
r = walk({ name: "Walt Drink", ticketTypeId: "WD", method: "cash", answers: {} });
ok(r.error === "BAD_REQUEST" && /Which drink/.test(r.message) && run("TBL.Tickets.length") === before, "a With-drink walk-in without a drink choice is refused");
r = walk({ name: "Walt Drink", ticketTypeId: "WD", method: "etransfer", answers: { QD: "Milk tea" } });
const walt = lastTicket();
ok(r.ok && r.ok.ok && walt.answers["Which drink would you like?"] === "Milk tea" && walt.checkedInAt, "a walk-in's drink choice is saved on the attendee, like a normal registration");
ok(r.ok.result.person.answers["Which drink would you like?"] === "Milk tea", "and the desk sees it in the check-in result");
ok(/e-transfer/.test(r.ok.result.message) && /paid by e-transfer/.test(run("TBL.Orders[TBL.Orders.length - 1].notes")), "a paid walk-in records how it was paid");
const deskList = run('doorList_("EVT", SESSION, {})');
ok(deskList.tickets.some((t) => t.name === "Walt Drink" && t.answers["Which drink would you like?"] === "Milk tea"), "the help desk's list shows the walk-in's drink");
r = walk({ name: "Wanda Water", ticketTypeId: "ND", method: "cash", answers: { QD: "Mango tea" } });
ok(r.ok && JSON.stringify(lastTicket().answers) === "{}", "a No-drink walk-in's drink answer is dropped");
r = walk({ name: "Mia Member", memberId: "CSS0011234", ticketTypeId: "NM", answers: {} });
ok(r.ok && r.ok.ok, "a free walk-in needs no payment method");
ok(run("TBL.Orders[TBL.Orders.length - 1].notes") === "Walk-in, free ticket" && !/cash/.test(r.ok.result.message), "and isn't recorded as cash: " + r.ok.result.message);

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
