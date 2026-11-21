// Event sign-up form in the browser (public/public.js), run offline with no network.
// Questions limited to some ticket types (forTickets): who sees them, what is required, what is sent.
// The total says "Choose tickets" until everyone has picked one. The ticket page's not-found state has a Find my tickets button.
const fs = require("fs"), vm = require("vm"), path = require("path");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

let requests = 0;
const ctx = { console, fetch: () => { requests++; throw new Error("no network in tests"); }, document: { querySelectorAll: () => [] } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/strings.js"), "utf8"), ctx);
const src = fs.readFileSync(path.join(__dirname, "../public/public.js"), "utf8").replace(/\bstart\(\);\s*$/, "");
vm.runInContext(src, ctx);
const run = (code) => vm.runInContext(code, ctx);

run(`currentEvent = {
  slug: "test-drinks",
  ticketTypes: [{ id: "drink", name: "With drink", price: 8 }, { id: "nodrink", name: "No drink", price: 0 }],
  questions: [
    { id: "flavour", label: "Which drink?", type: "choice", options: ["Milk tea", "Mango"], required: true, forTickets: ["drink"] },
    { id: "diet", label: "Allergies", type: "text", required: false },
    { id: "shirt", label: "Shirt size", type: "text", required: true, forTickets: [] }
  ]
};
var P = (extra) => Object.assign({ name: "TEST Person", email: "test@example.com", ucid: "30123456", answers: { shirt: "M" } }, extra);`);

// ---- questionApplies ----
ok(run(`questionApplies(currentEvent.questions[0], "drink")`) === true, "drink question applies to a drink ticket");
ok(run(`questionApplies(currentEvent.questions[0], "nodrink")`) === false, "drink question does not apply to a no-drink ticket");
ok(run(`questionApplies(currentEvent.questions[0], "")`) === false, "drink question waits until a ticket is picked");
ok(run(`questionApplies(currentEvent.questions[1], "nodrink")`) === true, "question with no forTickets applies to every ticket");
ok(run(`questionApplies(currentEvent.questions[2], "")`) === true, "empty forTickets applies to every ticket");

// ---- firstProblem ----
ok(run(`firstProblem([P({ ticketTypeId: "drink" })])`) === "Please fill in: Which drink?", "drink ticket with no drink chosen is blocked");
ok(run(`firstProblem([P({ ticketTypeId: "drink", answers: { shirt: "M", flavour: "Mango" } })])`) === "", "drink ticket with a drink chosen passes");
ok(run(`firstProblem([P({ ticketTypeId: "nodrink" })])`) === "", "no-drink ticket is not asked for a drink");
ok(run(`firstProblem([P({ ticketTypeId: "nodrink", answers: {} })])`) === "Please fill in: Shirt size", "question for every ticket is still required");
ok(run(`firstProblem([P({ ticketTypeId: "nodrink" }), P({ ticketTypeId: "drink" })])`) === "Please fill in: Which drink? (Friend 1)", "each friend is checked against their own ticket");

// ---- A tiny fake page: two people, their ticket radios and the drink box ----
run(`
function fakeEl(props) { return Object.assign({ hidden: false, value: "", textContent: "", dataset: {}, classList: { on: {}, toggle(c, v) { this.on[c] = !!v; } }, querySelectorAll: () => [], querySelector: () => null }, props); }
function person(i, typeId) {
  const radios = currentEvent.ticketTypes.map((t) => fakeEl({ type: "radio", value: t.id, checked: t.id === typeId, dataset: { f: "ticketTypeId" } }));
  const fields = [fakeEl({ dataset: { f: "name" }, value: "TEST P" + i }), fakeEl({ dataset: { f: "email" }, value: "p" + i + "@example.com" })].concat(radios);
  const inputs = currentEvent.questions.map((q) => fakeEl({ dataset: { q: q.id }, value: q.id === "flavour" ? "Mango" : "x" }));
  const boxes = currentEvent.questions.map((q, n) => fakeEl({ dataset: { question: q.id }, querySelectorAll: () => [inputs[n]] }));
  return { radios, inputs, boxes, el: fakeEl({
    querySelector: (sel) => sel.indexOf(":checked") >= 0 ? (radios.find((r) => r.checked) || null) : fakeEl({}),
    querySelectorAll: (sel) => sel === "[data-f]" ? fields : sel === "[data-q]" ? inputs : sel === "[data-question]" ? boxes : []
  }) };
}
var people = [person(0, "drink"), person(1, "")];
var els = { total: fakeEl({}), submit: fakeEl({ disabled: false }), "etransfer-block": fakeEl({}) };
document = { getElementById: (id) => els[id] || null, querySelectorAll: (sel) => sel === "#register-form .person" ? people.map((p) => p.el) : [] };
`);

// ---- updateQuestions ----
run(`updateQuestions()`);
ok(run(`people[0].boxes[0].hidden`) === false, "drink ticket: drink question shown");
ok(run(`people[1].boxes[0].hidden`) === true, "no ticket yet: drink question hidden");
ok(run(`people[1].boxes[1].hidden`) === false, "question for everyone is shown before a ticket is picked");
run(`people[0].radios[0].checked = false; people[0].radios[1].checked = true; updateQuestions()`);
ok(run(`people[0].boxes[0].hidden && people[0].inputs[0].value === ""`), "switching to no drink hides the drink question and clears its answer");
ok(run(`!("flavour" in readPeople()[0].answers)`), "a question that doesn't apply is not sent");
run(`people[0].radios[1].checked = false; people[0].radios[0].checked = true; people[0].inputs[0].value = "Milk tea"; updateQuestions()`);
ok(run(`readPeople()[0].answers.flavour`) === "Milk tea", "drink answer is sent for a drink ticket");

// ---- updateTotal ----
run(`updateTotal()`);
ok(run(`els.total.textContent`) === "Choose tickets", "one person still choosing: total says Choose tickets, not Free");
ok(run(`els.total.classList.on["total-pending"]`) === true, "pending total uses the neutral look");
ok(run(`els.submit.textContent`) === "Continue to payment instructions", "something owed already: button still says payment instructions");
run(`people[1].radios[1].checked = true; updateTotal()`);
ok(run(`els.total.textContent`) === "$8", "both chosen: real total shown");
run(`people[0].radios[0].checked = false; people[0].radios[1].checked = true; updateTotal()`);
ok(run(`els.total.textContent`) === "Free" && run(`els.total.classList.on["total-pending"]`) === false, "both chose a $0 ticket: Free");
run(`people = [person(0, "")]; updateTotal()`);
ok(run(`els.total.textContent`) === "Choose tickets" && run(`els.submit.textContent`) === "Register", "nobody chose yet: Choose tickets, plain Register button");

// ---- Draft kept for Back to event, only for the same form ----
ok(run(`formShape(currentEvent) === formShape(JSON.parse(JSON.stringify(currentEvent)))`), "same event reloaded: draft can be put back");
ok(run(`formShape(currentEvent) !== formShape(Object.assign({}, currentEvent, { ticketTypes: [] }))`), "event's tickets changed: draft is not put back");

// ---- Ticket page: not-found state ----
const ticketSrc = fs.readFileSync(path.join(__dirname, "../public/ticket.js"), "utf8");
ok(/NOT_FOUND[\s\S]{0,200}ticketNotFound[^\n]*href="tickets\.html"[^\n]*T\.findTitle/.test(ticketSrc), "ticket not found: panda plus a Find my tickets button to tickets.html");

ok(requests === 0, "no network requests");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
