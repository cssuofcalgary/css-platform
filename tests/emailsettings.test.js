// Per-event email settings, what counts as "waiting", the email indicator, and the payment-confirmed outcome numbers.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
function ev(id, slug, extra) {
  return Object.assign({ id:id, slug:slug, name:"Event " + id, date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
    status:"published", entryOpen:"FALSE", ticketTypes:[{ id:"TG", name:"General", price:8 }], questions:[], codePrefix:"EV", archivedAt:"", summary:{}, updatedAt:"2026-10-01T00:00:00Z" }, extra || {});
}
TBL.Events = [
  ev("EVD", "defaults"),
  ev("EVR", "reg-on", { mailRegistration:"TRUE" }),
  ev("EVN", "tickets-off", { mailTickets:"FALSE" }),
  ev("EVF", "free-night", { ticketTypes:[{ id:"FG", name:"Guest", price:0 }] }),
  ev("EVO", "over", { date:"2020-01-01" })
];
TBL.Orders = []; TBL.Tickets = [];
function table_() {}
function throttle_() {}
function withLock_(fn) { return fn(); }
var __tix = [], __reg = [];
function sendTicketEmail_(event, t) { __tix.push(t.id); return true; }
function sendRegistrationEmail_(event, order) { __reg.push(order.code); return true; }
function emailBrand_() { return { signerName: "A", signerRole: "B", buttonColor: "#000000" }; }
function ord(id, eventId, status) { insertRow_("Orders", { id:id, code:"X-"+id, eventId:eventId, payerName:"P"+id, payerEmail:id+"@x.ca", total:8, status:status, createdAt:"2026-10-01T00:00:00Z", notes:"", remindedAt:"", cancelRequestedAt:"" }); }
function tk(id, orderId, eventId, status, emailedAt) { insertRow_("Tickets", { id:id, secret:(id+"0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:eventId, name:"N"+id, email:id+"@x.ca", ucid:"", memberId:"", ticketType:"General", price:8, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt: emailedAt || "" }); }
`);
const mails = (id) => run(`eventMails_(findEvent_(function (e) { return e.id === "${id}"; }))`);

// ---- The defaults, and what a saved event keeps
let m = mails("EVD");
ok(m.registration === false && m.tickets === true && m.reminders === false, "never-chosen settings: registration email off, ticket on payment on, reminders off");
ok(mails("EVR").registration === true, "an event with the registration email ticked has it on");
ok(mails("EVN").tickets === false, "an event with tickets switched off has them off");
const base = { name: "Night", date: "2099-05-05", startTime: "18:00", endTime: "21:00", location: "MSC", capacity: "", capacityRule: "paid", ticketTypes: [{ name: "General", price: 5 }], questions: [] };
const clean = (over) => run("cleanEventInput_(" + JSON.stringify(Object.assign({}, base, over)) + ")");
let c = clean({});
ok(c.mailRegistration === false && c.mailTickets === true && c.mailReminders === false, "saving an event without choosing keeps the defaults");
c = clean({ mailRegistration: true, mailTickets: false, mailReminders: true });
ok(c.mailRegistration === true && c.mailTickets === false && c.mailReminders === true, "the three choices are saved as picked");

// ---- Signing up
const reg = (slug, people) => run(`register_(${JSON.stringify({ slug, people })})`);
let r = reg("defaults", [{ name: "Alex Guest", email: "alex@x.ca", ticketTypeId: "TG", answers: {} }]);
ok(r.ok && r.emailSent === false && run("__reg.length") === 0, "paid signup, default settings: no registration email goes out");
ok(r.emails.confirmation === false && r.emails.ticket === true, "the page is told: no confirmation email, ticket email after payment");
ok(r.order.total === 8 && r.etransferEmail && r.order.code && /^ticket\.html\?t=/.test(r.tickets[0].page), "and it still has the amount, e-transfer address, payment code and ticket link to show");
r = reg("reg-on", [{ name: "Bea Guest", email: "bea@x.ca", ticketTypeId: "TG", answers: {} }]);
ok(r.emailSent === true && run("__reg.length") === 1 && r.emails.confirmation === true, "with the registration email ticked, it is sent");
r = reg("tickets-off", [{ name: "Cy Guest", email: "cy@x.ca", ticketTypeId: "TG", answers: {} }]);
ok(r.emails.ticket === false, "with ticket emails off the page is told no ticket will be emailed");

// ---- Free event: one email only, the ticket
run("__tix.length = 0; __reg.length = 0;");
r = reg("free-night", [{ name: "Free Person", email: "free@x.ca", ticketTypeId: "FG", answers: {} }]);
ok(r.order.status === "paid" && run("__tix.length") === 1 && run("__reg.length") === 0, "a free signup gets just the ticket email, never a confirmation as well");
ok(r.emails.confirmation === false && r.emails.ticket === true, "and says so");

// ---- Ticket email switched off: a choice, not a queue
run(`
TBL.Orders = []; TBL.Tickets = []; __tix.length = 0;
ord("O1", "EVN", "paid"); tk("TKTOFF001", "O1", "EVN", "paid"); tk("TKTOFF002", "O1", "EVN", "paid");
ord("O2", "EVD", "paid"); tk("TKTON0001", "O2", "EVD", "paid"); tk("TKTON0002", "O2", "EVD", "paid");
ord("O3", "EVD", "paid"); tk("TKTWAIT01", "O3", "EVD", "paid");
`);
let s = run('sendPendingTicketEmails_("O1")');
ok(s.sent === 0 && s.notEmailed === 2 && s.waiting === 0 && run("__tix.length") === 0, "tickets off: nothing is sent and nothing is left waiting: " + JSON.stringify(s));
ok(run("TBL.Tickets.filter(function (t) { return t.orderId === 'O1'; }).every(function (t) { return /turned off/.test(t.emailedAt); })"), "the tickets say why they weren't emailed");
s = run('sendPendingTicketEmails_("O1")');
ok(s.notEmailed === 0 && run("__tix.length") === 0, "a second run does nothing (it doesn't pile up or retry)");
s = run('sendPendingTicketEmails_("O1", 0, true)');
ok(s.sent === 2 && run("__tix.length") === 2, "Resend tickets (Finance pressing it on purpose) still sends");
s = run('sendPendingTicketEmails_("O2")');
ok(s.sent === 2 && s.notEmailed === 0, "an event with tickets on sends them");

// ---- The email indicator counts only what is really waiting
run(`
TBL.Tickets.forEach(function (t) { if (t.id === "TKTWAIT01") t.emailedAt = ""; });
ord("O4", "EVO", "paid"); tk("TKTOLD001", "O4", "EVO", "paid");
`);
const st = run("emailStatus_()");
ok(st.ok && st.left === 90 && st.waiting === 1, "indicator: 90 left, 1 waiting (the suppressed and the past-event tickets don't count): " + JSON.stringify(st));
ok(typeof st.checkedAt === "string" && st.checkedAt.length > 10, "it says when it was checked");

// ---- Reminders follow the event's setting
const S = '{ name: "Fin", role: "admin" }';
let refused = "";
try { run(`sendReminders_(${S}, "EVD", true)`); } catch (e) { refused = e.message; }
ok(/turned off for this event/.test(refused), "reminders off: the button explains instead of sending: " + refused);
run('TBL.Events.filter(function (e) { return e.id === "EVD"; })[0].mailReminders = "TRUE"; delete DB_.rows["Events"];');
const dry = run(`sendReminders_(${S}, "EVD", true)`);
ok(dry.ok === true, "reminders on: the count works");

// ---- "N confirmed. X emailed; Y waiting"
run(`
TBL.Orders = []; TBL.Tickets = [];
ord("P1", "EVD", "awaiting"); tk("TKTPAY001", "P1", "EVD", "awaiting"); tk("TKTPAY002", "P1", "EVD", "awaiting"); tk("TKTPAY003", "P1", "EVD", "awaiting");
function sendTicketEmail_(event, t) { return t.id !== "TKTPAY003"; }
`);
const paid = run(`markOrderPaid_(${S}, "P1", false, "")`);
ok(paid.confirmed === 3 && paid.emailsSent === 2 && paid.emailsWaiting === 1, "3 confirmed, 2 emailed, 1 waiting: " + JSON.stringify(paid));
ok(run("TBL.Orders[0].status") === "paid" && run("TBL.Tickets.every(function (t) { return t.status === 'paid'; })"), "the payment is kept even though one email didn't go");
ok(paid.emailsLeftToday === 90, "the reply carries the remaining allowance");

// ---- Preview editor: template text, shared labels and isolated unsaved changes.
const templateSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '../api/EmailTemplates.js'), 'utf8');
run(templateSource.slice(templateSource.indexOf('function emailBrand_()'), templateSource.indexOf('// ---- Admin actions')));
run('TBL.Emails = [];');
const editedPreview = run(`previewEmail_("registration", {title:"Corrected heading",intro:"Hi {name}, welcome to **{event}**."},
  {signerName:"TEST Signer",signerRole:"TEST Role",buttonColor:"#123456",labels:{amount:"Total due",message:"Payment code"}},true)`);
ok(editedPreview.html.includes('data-email-edit="title"') && editedPreview.html.includes('data-email-edit="label-amount"') &&
  editedPreview.html.includes('Corrected heading') && editedPreview.html.includes('TEST Signer'), 'editable preview marks wording, payment labels and signature');
ok(editedPreview.html.includes('Total due') && editedPreview.html.includes('MGN-4408') && editedPreview.html.includes('pay@css.test'), 'label edits keep payment code and actual destination');
ok(editedPreview.html.includes('Hi Alex Chen, welcome to <b>Mahjong Games Night</b>.'), 'fill-ins and bold still render correctly');
ok(run('TBL.Emails.length') === 0 && run('EMAIL_EDIT_PREVIEW_ === false && EMAIL_OVERRIDE_ === null && EMAIL_BRAND_PREVIEW_ === null'), 'preview saves nothing and clears all rendering overrides');
const normalPreview = run('previewEmail_("registration")');
ok(!normalPreview.html.includes('data-email-edit') && !normalPreview.html.includes('TEST Signer') && !normalPreview.html.includes('Total due'), 'ordinary email stays free of editor markers and unsaved wording');
run(`saveEmailTemplate_({name:"TEST Editor"},"registration",{title:"Saved correction",intro:"Hello {name}",closing:"-"});
  saveEmailBrand_({name:"TEST Editor"},{labels:{amount:"Total due"}});`);
const savedPreview = run('previewEmail_("registration")');
ok(savedPreview.html.includes('Saved correction') && savedPreview.html.includes('Hello Alex Chen') && savedPreview.html.includes('Total due') &&
  !savedPreview.html.includes("If your bank doesn't allow"), 'saved correction, labels and intentionally empty paragraph persist');
const unsafePreview = run('previewEmail_("registration",{title:"<script>alert(1)</script>"},{signerName:"<img onerror=x>",labels:{amount:"<svg onload=x>"}},true)');
ok(unsafePreview.html.includes('&lt;script&gt;') && unsafePreview.html.includes('&lt;img onerror=x&gt;') && !unsafePreview.html.includes('<svg onload=x>'), 'editable wording stays HTML escaped');
ok(run('previewEmail_("waitlist").html').includes("You're on the waitlist") && run('previewEmail_("memberWelcome").html').includes("You're a CSS member!"), 'waitlist and membership previews use their own email templates');
run('var originalTicketBuilder = buildTicketEmail_; buildTicketEmail_ = function(){throw new Error("TEST preview failure");};');
let previewFailed = false;
try { run('buildEmailPreview_("ticket",{title:"Unsaved"},{signerName:"TEST temporary"},true);'); } catch(e) { previewFailed = true; }
run('buildTicketEmail_ = originalTicketBuilder;');
ok(previewFailed && run('EMAIL_EDIT_PREVIEW_ === false && EMAIL_OVERRIDE_ === null && EMAIL_BRAND_PREVIEW_ === null'), 'failed preview clears overrides before any subsequent email');

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
