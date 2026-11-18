// Members → All members: every row of the sheet for the list, and "Create member ID" for a row that reached the sheet without one
// (a form outside the site, or typed in by hand), so it can be marked paid like anyone else.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || "ERROR", msg: e.message }; } };

run(`
function withIntakeLock_(f) { return f(); }
var __writes = [], __logs = [];
function log_(who, action, target, d) { __logs.push(action); }
var COLS = { memberId: 15, paid: 14, mailStatus: 17 };
function m(row, extra) {
  return Object.assign({ row: row, memberId: "", name: "TEST Row " + row, ucid: "3010000" + row, email: "r" + row + "@example.com", paid: false, status: "",
    cardSent: false, mailStatus: "", signedUp: "2026-09-1" + row + "T12:00:00Z", payment: { method: "Cash", when: "", where: "", who: "" } }, extra || {});
}
TBL.__members = [
  m(2, { memberId: "CSS0011234", paid: true, status: "PAID", cardSent: true, mailStatus: "Sent" }),
  m(3),                                                                             // from an outside form: no ID, no status
  m(4, { payment: { method: "E-transfer", when: "", where: "", who: "" } }),
  m(5, { paid: true, status: "PAID" }),                                             // paid by hand, never got an ID or a card
  m(6, { memberId: "CSS0055555", status: "Awaiting Cash" })
];
function openMemberSheet_() {
  return { members: TBL.__members, columns: COLS, portalColumn: 16, lastRow: 6,
    sheet: { getRange: function (r, c) { return { setValue: function (v) { __writes.push([r, c, v]); } }; } } };
}
function setMemberCells_(book, member, changes) { Object.keys(changes).forEach(function (f) { __writes.push([member.row, book.columns[f] + 1, changes[f]]); }); }
var S = { name: "TEST Exec", role: "exec" };
`);

const all = run("listAllMembers_()");
ok(all.ok && all.total === 5 && all.members.length === 5, "All members lists every row of the sheet, including the ones with no member ID");
ok(all.members.some((x) => x.row === 3 && x.memberId === "") && all.members[0].payment && "cardSent" in all.members[0], "each row carries what the list shows (ID or none, status, card, payment)");

let r = fn(`assignMemberId_(S, 3, "TEST Row 3")`);
ok(r.v && r.v.ok && /^CSS002\d{4}$/.test(r.v.member.memberId), "Create member ID gives the row an ID in the usual pattern: " + (r.v && r.v.member.memberId));
const w3 = run("__writes.filter(function (w) { return w[0] === 3; })");
ok(w3.some((w) => w[1] === 16 && /^CSS/.test(w[2])) && w3.some((w) => w[1] === 15 && w[2] === "Awaiting Cash") && w3.some((w) => w[1] === 18 && w[2] === "Pending"),
  "…and an unpaid row with no status becomes Awaiting Cash (so it shows in Pending), its card Pending");
ok(w3.some((w) => w[1] === 17 && /member\.ucalgarycss\.ca\/CSS/.test(w[2])), "…and the sheet's Portal Link column gets the member link");
ok(run("__logs").indexOf("member.assignId") !== -1, "…and it's written to Activity");

r = fn(`assignMemberId_(S, 4, "TEST Row 4")`);
ok(r.v && run(`__writes.some(function (w) { return w[0] === 4 && w[2] === "Awaiting E-transfer"; })`), "an e-transfer row becomes Awaiting E-transfer");

run("__writes.length = 0;");
r = fn(`assignMemberId_(S, 5, "TEST Row 5")`);
ok(r.v && r.v.member.memberId && !run(`__writes.some(function (w) { return w[1] === 15; })`) && run(`__writes.some(function (w) { return w[1] === 18 && w[2] === "Pending"; })`),
  "a row already marked paid keeps its Paid status, and its card is Pending (so Needs attention offers Resend card)");

r = fn(`assignMemberId_(S, 2, "TEST Row 2")`);
ok(r.v && r.v.already && r.v.member.memberId === "CSS0011234", "a row that already has an ID keeps it");
r = fn(`assignMemberId_(S, 6, "Someone Else")`);
ok(r.err === "NOT_FOUND" && /sorted/.test(r.msg), "if the row now holds someone else (the sheet was sorted), nothing is written and it says to refresh");
r = fn(`assignMemberId_(S, 99, "TEST Row 99")`);
ok(r.err === "NOT_FOUND", "a row that's gone says so");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
