// Explicit membership rechecks and email corrections on existing tickets. All services are fake.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { run } = require("./harness.js");

run(`
var __membershipReads = [], __membershipReadFails = false, __ticketEmails = 0;
function loadMembers_(fresh) {
  __membershipReads.push(fresh === true);
  if (__membershipReadFails) throw new Error("Fake membership sheet unavailable");
  return TBL.__members;
}
function sendPendingTicketEmails_() { __ticketEmails++; return { sent: 1, waiting: 0 }; }
function resetEditTest_() {
  __membershipReads = []; __membershipReadFails = false; __ticketEmails = 0;
  TBL.Events = [{ id:"EV1", name:"Test Event", ticketTypes:[{ id:"MEM", name:"Member", price:0, needsMembership:true }], questions:[] }];
  TBL.Orders = [{ id:"OR1", eventId:"EV1", code:"TEST-1234", total:0, status:"awaiting", payerName:"Test Member", payerEmail:"member@example.com", notes:"" }];
  TBL.Tickets = [{ id:"TK1", eventId:"EV1", orderId:"OR1", name:"Test Member", email:"member@example.com", ucid:"30123456", memberId:"CSS0011234", ticketType:"Member", price:0, status:"awaiting", flag:"Member price, but membership isn't paid yet; Already registered with this email", emailedAt:"" }];
  TBL.__members = [{ name:"Test Member", email:"member@example.com", ucid:"30123456", memberId:"CSS0011234", paid:true }];
}
`);
const reset = () => run("resetEditTest_()");
const edit = (changes, orderChanges = {}, role = "admin") => run(`updateTicket_(${JSON.stringify({ name:"Test Exec", role })}, "TK1", ${JSON.stringify(changes)}, "", ${JSON.stringify(orderChanges)})`);

reset();
let reply = edit({ recheckMembership:true });
assert.strictEqual(reply.changed, true);
assert.strictEqual(run("TBL.Tickets[0].flag"), "Already registered with this email");
assert.strictEqual(run("__membershipReads.length === 1 && __membershipReads[0]"), true);
assert.strictEqual(run("TBL.Orders[0].status"), "awaiting");
assert.strictEqual(run("TBL.Tickets[0].status"), "awaiting");
assert.strictEqual(run("__ticketEmails"), 0);
console.log("PASS An admin recheck uses fresh membership, clears the old unpaid warning, preserves other warnings and leaves payment unchanged");

reset();
run("TBL.Tickets[0].flag = 'Member price, but no membership found'; TBL.Orders[0].notes = 'Requires exec verification of member status'");
edit({ recheckMembership:true });
assert.strictEqual(run("TBL.Tickets[0].flag"), "");
assert.strictEqual(run("TBL.Tickets[0].status"), "awaiting");
assert.strictEqual(run("TBL.Orders[0].status"), "awaiting");
assert.strictEqual(run("__ticketEmails"), 0);
const confirmed = run('markOrderPaid_({ name:"Test Exec", role:"admin" }, "OR1", false, "")');
assert.strictEqual(confirmed.confirmed, 1);
assert.strictEqual(run("TBL.Tickets[0].status"), "paid");
assert.strictEqual(run("TBL.Orders[0].status"), "paid");
assert.strictEqual(run("__ticketEmails"), 1);
console.log("PASS A held free ticket whose membership now exists clears its warning, waits for manual Mark paid, and only then uses the ticket email flow");

reset();
run("TBL.Tickets[0].ucid = '30999999'");
edit({ ucid:"30123456", flag:run("TBL.Tickets[0].flag") });
assert.strictEqual(run("TBL.Tickets[0].flag"), "Already registered with this email");
console.log("PASS Correcting a member identity still recalculates the warning when the unchanged flag is explicitly supplied");

reset();
run("TBL.__members[0].paid = false");
reply = edit({ recheckMembership:true });
assert.match(run("TBL.Tickets[0].flag"), /membership isn't paid yet/);
assert.match(run("TBL.Tickets[0].flag"), /Already registered/);
console.log("PASS A membership that is still unpaid keeps its warning");

reset();
run("TBL.Tickets[0].name = 'Different Attendee'");
edit({ recheckMembership:true });
assert.match(run("TBL.Tickets[0].flag"), /name doesn't match/);
console.log("PASS Rechecking includes the attendee name and refuses a different person's member ID");

reset();
edit({ name:"Different Attendee" });
assert.match(run("TBL.Tickets[0].flag"), /name doesn't match/);
console.log("PASS Changing an attendee name as admin also checks that the membership still fits");

reset();
run("__membershipReadFails = true");
edit({ flag:"", recheckMembership:true });
assert.strictEqual(run("TBL.Tickets[0].flag"), "");
assert.strictEqual(run("__membershipReads.length"), 0);
console.log("PASS An admin's explicit flag change takes precedence over rechecking");

reset();
assert.throws(() => edit({ recheckMembership:true }, {}, "exec"), (error) => error.code === "ADMIN_ONLY");
assert.strictEqual(run("__membershipReads.length"), 0);
assert.match(run("TBL.Tickets[0].flag"), /membership isn't paid yet/);
console.log("PASS A regular exec cannot use the membership recheck to change admin-only flags");

reset();
run("__membershipReadFails = true");
assert.throws(() => edit({ name:"Test Member Updated", recheckMembership:true }), /Fake membership sheet unavailable/);
assert.strictEqual(run("TBL.Tickets[0].name"), "Test Member");
assert.match(run("TBL.Tickets[0].flag"), /membership isn't paid yet/);
console.log("PASS A failed deliberate recheck saves no partial changes and does not erase the warning");

reset();
run("TBL.Events[0].ticketTypes = []");
assert.throws(() => edit({ recheckMembership:true }), (error) => error.code === "BAD_REQUEST" && /Choose a current ticket type/.test(error.message));
assert.match(run("TBL.Tickets[0].flag"), /membership isn't paid yet/);
console.log("PASS A removed ticket type cannot accidentally clear a membership warning");

reset();
assert.throws(() => edit({ email:"member@gnail.com" }), (error) => error.code === "BAD_REQUEST" && /gmail\.com/.test(error.message));
assert.strictEqual(run("TBL.Tickets[0].email"), "member@example.com");
assert.throws(() => edit({}, { payerEmail:"payer@gnail.com" }), (error) => error.code === "BAD_REQUEST" && /gmail\.com/.test(error.message));
assert.strictEqual(run("TBL.Orders[0].payerEmail"), "member@example.com");
console.log("PASS Changed attendee and payer addresses reject common email-domain typos without saving");

reset();
run("TBL.Tickets[0].email = TBL.Orders[0].payerEmail = 'member@gnail.com'");
reply = edit({ email:"member@gnail.com" }, { payerEmail:"member@gnail.com", notes:"Checked payment manually" });
assert.strictEqual(reply.changed, true);
assert.strictEqual(run("TBL.Orders[0].notes"), "Checked payment manually");
assert.strictEqual(run("TBL.Tickets[0].email"), "member@gnail.com");
console.log("PASS An unchanged legacy email typo does not block saving unrelated corrections");

reset();
run("TBL.Tickets[0].status = TBL.Orders[0].status = 'paid'");
edit({ email:"corrected@example.com" });
assert.strictEqual(run("TBL.Tickets[0].email"), "corrected@example.com");
assert.strictEqual(run("TBL.Orders[0].payerEmail"), "corrected@example.com");
assert.strictEqual(run("__ticketEmails"), 1);
console.log("PASS Correcting a paid attendee's email keeps payer details in step and uses the existing ticket resend flow");

const fields = {};
const element = (id) => fields[id] || (fields[id] = { value:"", addEventListener() {} });
const ui = vm.createContext({
  $: element,
  state: { role:"admin" },
  document: { querySelectorAll: () => [] }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "exec-portal", "edit.js"), "utf8"), ui);
vm.runInContext(`editState.ctx = {
  ticket:{ name:"Test Member", email:"member@example.com", ucid:"30123456", memberId:"CSS0011234", ticketType:"Member", flag:"Member price, but membership isn't paid yet" },
  order:{}, event:{ ticketTypes:[{ id:"MEM", name:"Member" }], questions:[] }
};`, ui);
Object.entries({ "ed-name":"Test Member", "ed-email":"member@example.com", "ed-ucid":"30123456", "ed-member":"CSS0011234", "ed-flag":"Member price, but membership isn't paid yet", "ed-type":"MEM" }).forEach(([id, value]) => { element(id).value = value; });
assert.strictEqual(vm.runInContext("collectEditChanges().changes.recheckMembership", ui), true);
element("ed-flag").value = "";
assert.strictEqual(vm.runInContext("collectEditChanges().changes.recheckMembership", ui), undefined);
assert.strictEqual(vm.runInContext("collectEditChanges().changes.flag", ui), "");
ui.state.role = "exec";
assert.strictEqual(vm.runInContext("collectEditChanges().changes.recheckMembership", ui), undefined);
console.log("PASS Admin Save explicitly requests a recheck only for an unchanged membership warning; an edited flag or regular exec does not");
console.log("ALL PASSED");
