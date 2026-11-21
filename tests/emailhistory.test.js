// Real email wrapper with a fake mailer; shared history never contains email bodies or private links.
const { run, sent } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code || "ERROR", message: e.message }; } };

run(`
var __logFails = false, __mailFails = false;
var __fakeMailer = MailApp.sendEmail;
MailApp.sendEmail = function (mail) { if (__mailFails) throw new Error("Fake email failure"); return __fakeMailer(mail); };
function log_(who, action, target, details) {
  if (__logFails) throw new Error("Fake log failure");
  insertRow_("Log", {time:new Date().toISOString(),who:who,action:action,target:target,details:JSON.stringify(details)});
}
function readLastRows_(table, count) { return (TBL[table] || []).slice(-count); }
TBL.Log = [];
`);

run('sendStyled_("test@css.test", "Your CSS pass", "<p>private-pass-link</p>", "private-pass-link")');
ok(sent.length === 1 && sent[0].subject === "Your CSS pass", "the email still goes through the shared sender with its original subject");
let entries = run("listRecentEmails_().entries");
ok(entries.length === 1 && entries[0].status === "sent" && entries[0].to === "test@css.test" && entries[0].subject === "Your CSS pass", "a successful email records recipient, subject, time and Sent");
ok(!JSON.stringify(run("TBL.Log")).includes("private-pass-link") && !JSON.stringify(entries).includes("htmlBody"), "the log keeps no email body or private pass link");
run("__mailFails = true;");
const failure = attempt('sendStyled_("failed@css.test", "Your ticket", "", "")');
ok(failure.message === "Fake email failure" && sent.length === 1, "a failed send still throws, so callers cannot mark a card or ticket sent");
ok(run('listRecentEmails_().entries.some(function(e) { return e.status === "failed" && e.subject === "Your ticket"; })'), "failed attempts appear as Failed with the subject");
run("__mailFails = false; __logFails = true;");
ok(!attempt('sendStyled_("success@css.test", "Payment received", "", "")').error && sent.length === 2, "a broken log never turns a successful send into a failed email or causes a retry");
run("__mailFails = true;");
ok(attempt('sendMail_({to:"fail@css.test",subject:"Failure",body:""})').message === "Fake email failure", "a broken log also preserves the original send failure");
run("__mailFails = false; __logFails = false;");
run('sendMail_({to:"test@css.test",subject:"Admin alert",body:"Alert",attachments:["fake attachment"]})');
ok(sent[2].attachments[0] === "fake attachment" && run('listRecentEmails_().entries.some(function(e) { return e.subject === "Admin alert"; })'), "plain emails and attachments use the same log without changing send options");

run(`
Date.now = function () { return Date.parse("2026-11-18T21:00:00Z"); };
function emailRow(time, action, subject) { return {time:time,action:action,target:"test@css.test",details:JSON.stringify({subject:subject})}; }
TBL.Log = [
 emailRow("2026-11-17T20:59:59Z", "email.sent", "Too old"),
 emailRow("2026-11-17T21:00:00Z", "email.sent", "Exactly 24 hours"),
 emailRow("2026-11-18T20:59:00Z", "email.failed", "Latest failure"),
 emailRow("2026-11-18T19:00:00Z", "email.sent", "Earlier success"),
 emailRow("2026-11-18T21:00:01Z", "email.sent", "Future"),
 emailRow("not a date", "email.sent", "Bad time"),
 emailRow("2026-11-18T20:00:00Z", "member.resendPass", "Not an email log"),
 {time:"2026-11-18T20:00:00Z",action:"email.sent",details:"broken"},
 {time:"2026-11-18T20:00:00Z",action:"email.sent",details:"null"}
];
var __exec = startSession_("TEST Exec", "exec");
var __admin = startSession_("TEST Admin", "admin");
var __door = startSession_("TEST Door", "door");
`);
entries = run('route_({action:"listRecentEmails",token:__exec}).entries');
ok(entries.length === 3 && entries.map(e => e.subject).join("|") === "Latest failure|Earlier success|Exactly 24 hours", "history covers a rolling 24 hours, newest first; skips old, future, unrelated and malformed records");
ok(run('route_({action:"listRecentEmails",token:__admin}).entries.length') === 3, "admins see the same shared history as execs");
ok(attempt('route_({action:"listRecentEmails"})').error === "NOT_LOGGED_IN", "email history requires sign-in");
ok(attempt('route_({action:"listRecentEmails",token:__door})').error === "DOOR_ONLY", "door volunteers cannot read email recipients and subjects");
run("TBL.Log = [];");
ok(run("listRecentEmails_().entries.length") === 0 && !run("listRecentEmails_().partial"), "an empty log is empty and does not invent older subject lines");
run('TBL.Log = Array.from({length:5001}, function() { return emailRow("2026-11-18T20:00:00Z", "checkin", ""); });');
ok(run("listRecentEmails_().partial"), "a very busy log reports that older records might be missing");
run('TBL.Log[1].time = "2026-11-16T20:00:00Z";');
ok(!run("listRecentEmails_().partial"), "reading back beyond the 24-hour window reports complete coverage");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
