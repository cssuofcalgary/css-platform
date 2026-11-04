// The membership year follows the date (September to August); the fee comes from Settings and shows wherever money is asked for.
const fs = require("fs"), path = require("path");
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const J = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || e.message, msg: e.message }; } };

// The harness swaps in a fixed getConfig_; put the real one back so the fee is read from the (fake) Script Properties.
const config = fs.readFileSync(path.join(__dirname, "..", "api", "Config.js"), "utf8").replace(/\r\n/g, "\n");
run(config.slice(config.indexOf("function getConfig_()"), config.indexOf("\n}\n", config.indexOf("function getConfig_()")) + 2));
run(`
var __props = PropertiesService.getScriptProperties();
__props.setProperty("EXEC_PASSWORD", "exec-test-pw"); __props.setProperty("ADMIN_PASSWORD", "admin-test-pw");
function extractSheetId_(v) { return String(v || ""); }
var __admin = { name: "Admin", role: "admin" };
`);

// ---- The school year
const year = (iso) => run(`membershipYear_(new Date("${iso}"))`);
ok(year("2026-09-01T12:00:00Z") === "2026/2027", "September 1 starts the new year: " + year("2026-09-01T12:00:00Z"));
ok(year("2027-01-15T12:00:00Z") === "2026/2027", "January is still the year that began in September");
ok(year("2027-08-31T12:00:00Z") === "2026/2027", "August 31 is the last day of the year");
ok(year("2027-09-01T12:00:00Z") === "2027/2028", "the next September moves on by itself: " + year("2027-09-01T12:00:00Z"));
ok(/^\d{4}\/\d{4}$/.test(run("membershipYear_()")), "today's year has the usual look: " + run("membershipYear_()"));

// ---- The fee: $12 until someone saves another
ok(run("getConfig_().membershipFee") === 12, "no fee saved yet: $12");
let r = J(`saveSettings_(__admin, "", { membershipFee: "15" })`);
ok(r.v && r.v.changed.indexOf("membership fee") !== -1 && r.v.membershipFee === 15, "Settings saves a new fee: " + JSON.stringify(r.v || r));
ok(run("getConfig_().membershipFee") === 15, "and it is used from then on");
ok(run("getSettings_('').settings.membershipFee") === 15, "Settings shows the saved fee");
r = J(`saveSettings_(__admin, "", { membershipFee: "$12.50" })`);
ok(r.v && run("getConfig_().membershipFee") === 12.5, "a dollar sign and cents are fine");
r = J(`saveSettings_(__admin, "", { membershipFee: "12.50" })`);
ok(r.v && r.v.changed.length === 0, "saving the same fee again changes nothing");
["", "abc", "-3", "12.555", "5000"].forEach((bad) => {
  const b = J(`saveSettings_(__admin, "", { membershipFee: ${JSON.stringify(bad)} })`);
  ok(b.err === "BAD_REQUEST", "refuses the fee " + JSON.stringify(bad) + " with a plain message: " + b.msg);
});
ok(run("getConfig_().membershipFee") === 12.5, "a refused fee leaves the saved one alone");
run(`__props.setProperty("MEMBERSHIP_FEE", "nonsense")`);
ok(run("getConfig_().membershipFee") === 12, "a broken value in Script Properties falls back to $12");
run(`__props.setProperty("MEMBERSHIP_FEE", "0")`);
ok(run("getConfig_().membershipFee") === 0, "a free membership (0) is allowed");
run(`__props.setProperty("MEMBERSHIP_FEE", "15")`);

// ---- What the person joining sees
run(`function addMemberRowLocked_() { return { memberId: "CSS0021234" }; }`);
r = J(`publicRegisterMember_({ name: "Ann Lee", ucid: "30123456", email: "ann@example.com", method: "etransfer" })`);
ok(r.v && r.v.fee === 15 && r.v.year === run("membershipYear_()"), "the sign-up reply carries the saved fee and this year: " + JSON.stringify(r.v && { fee: r.v.fee, year: r.v.year }));
run(`function addMemberRowLocked_() { return { existing: { name: "Ann Lee", paid: true, memberId: "CSS0021234", payment: {} } }; }`);
r = J(`publicRegisterMember_({ name: "Ann Lee", ucid: "30123456", email: "ann2@example.com", method: "cash" })`);
ok(r.err === "ALREADY_MEMBER" && r.msg.indexOf(run("membershipYear_()")) !== -1, "an existing member is told this year's membership: " + r.msg);

// ---- What the exec sees: the fee travels with the member screens, so the Mark paid buttons show it
run(`var __tok = startSession_("Exec", "exec"); TBL.__members = [{ memberId: "CSS0031234", name: "Bo Chan", email: "bo@example.com", ucid: "30111111", paid: false, status: "Awaiting Cash", row: 3, payment: {} }];`);
ok(run(`route_({ action: "searchMembers", token: __tok, query: "bo" }).membershipFee`) === 15, "member search replies carry the fee");
ok(run(`route_({ action: "getMember", token: __tok, memberId: "CSS0031234" }).membershipFee`) === 15, "a member's page carries the fee");
ok(run(`listPendingMembers_(0, 20).membershipFee`) === 15, "the Pending list carries the fee");

// ---- The words on the buttons (exec portal strings.js)
const strings = {};
new Function("exports", fs.readFileSync(path.join(__dirname, "..", "exec-portal", "strings.js"), "utf8") + "; exports.T = T;")(strings);
ok(strings.T.memberMarkPaid(15) === "Mark paid ($15)" && strings.T.memberMarkPaid(12.5) === "Mark paid ($12.50)", "Mark paid shows the fee: " + strings.T.memberMarkPaid(12.5));
ok(strings.T.maPaidNow(15) === "Payment received ($15)", "Add member shows the fee");
ok(strings.T.memberMarkPaid(null) === "Mark paid", "before the fee is known the button just says Mark paid");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
