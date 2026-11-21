// Server checks apply even when an old page or the member portal bypasses browser validation.
const assert = require("node:assert/strict");
const { run } = require("./harness.js");
let checks = 0;
function test(name, check) { check(); checks++; console.log("PASS " + name); }
function call(name, ...args) { return run(name + "(" + args.map((v) => JSON.stringify(v)).join(",") + ")"); }
const event = { id: "EV1", slug: "night", name: "Night", date: "2099-01-01", status: "published", ticketTypes: [{ id: "G", name: "General", price: 5 }, { id: "M", name: "Member", price: 0, needsMembership: true }], questions: [], codePrefix: "NT" };
const person = (extra) => Object.assign({ name: "Test Guest", email: "guest@example.com", ucid: "30123456", ticketTypeId: "G", answers: {} }, extra);
const clean = (extra, index = 0, lenient = false) => call("cleanPerson_", person(extra), event, index, lenient);
const rejects = (fn, message) => assert.throws(fn, (e) => e.code === "BAD_REQUEST" && message.test(e.message));

test("a valid student UCID is kept", () => assert.equal(clean().ucid, "30123456"));
test("a CSS code can replace UCID on any ticket type", () => assert.equal(clean({ ucid: "", memberId: " css1234567 " }).memberId, "CSS1234567"));
test("a public guest must provide a UCID or CSS code", () => rejects(() => clean({ ucid: "" }), /UCID or CSS member ID is required/));
test("a friend also needs a UCID or CSS code", () => rejects(() => clean({ ucid: "" }, 1), /Friend 1's UCID or CSS member ID/));
test("member pricing cannot omit both IDs", () => rejects(() => clean({ ucid: "", ticketTypeId: "M" }), /UCID or CSS member ID/));
for (const ucid of ["123", "123456789", "abc30123456", "3012-3456", "3012 3456"]) {
  test("invalid UCID is refused without silently changing it: " + ucid, () => rejects(() => clean({ ucid }), /exactly 8 digits/));
}
test("an invalid UCID is still refused when a code is present", () => rejects(() => clean({ ucid: "123", memberId: "CSS1234567" }), /exactly 8 digits/));
test("staff can add someone without either ID", () => assert.equal(clean({ ucid: "" }, 0, true).ucid, ""));
test("email is trimmed and lowercased", () => assert.equal(clean({ email: " TEST@Example.com " }).email, "test@example.com"));
for (const email of ["person@gnail.com", "person@gmial.com", "person@gamil.com", "person@gmail.con", "person@hotmail.con", "person@outlok.com", "person@yahoo.con", "person@ucalgary.con"]) {
  test("obvious domain typo is refused: " + email, () => rejects(() => clean({ email }), /did you mean/));
}
for (const email of ["someone@custom-club.ca", "member+event@example.org", "person@gmail.com"]) {
  test("valid email remains unchanged: " + email, () => assert.equal(clean({ email }).email, email));
}
test("an overlong address is refused rather than truncated", () => rejects(() => clean({ email: "a".repeat(115) + "@example.com" }), /doesn't look right/));
for (const email of ["person@gnail.com.", "person@gnail..com", "person@-gmail.com", "person@gmail-.com"]) {
  test("invalid email domain is refused: " + email, () => rejects(() => clean({ email }), /doesn't look right/));
}
test("membership signup also checks obvious typos", () => rejects(() => call("cleanMemberInput_", { name: "Test Member", ucid: "30123456", email: "person@gnail.com", method: "etransfer" }), /did you mean gmail.com/));

run(`TBL.Events = ${JSON.stringify([event])}; TBL.Orders = []; TBL.Tickets = []; TBL.Waitlist = []; function table_() {} function throttle_() {}`);
test("a missing ID never creates an order or ticket", () => {
  rejects(() => call("register_", { slug: "night", people: [person({ ucid: "" })] }), /UCID or CSS member ID/);
  assert.equal(run("TBL.Orders.length + TBL.Tickets.length"), 0);
});
test("a mistyped email never creates an order or ticket", () => {
  rejects(() => call("register_", { slug: "night", people: [person({ email: "frigidernie@gnail.com" })] }), /did you mean gmail.com/);
  assert.equal(run("TBL.Orders.length + TBL.Tickets.length"), 0);
});
console.log(checks + " checks passed");
