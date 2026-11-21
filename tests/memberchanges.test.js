// Shared member notes, successful/failed card sends, and unchanged payment view contents.
const fs = require("fs"), path = require("path");
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code || "ERROR" }; } };

run(`
var __memberCache = {}, __mailWorks = true, __moveOnSend = false;
CacheService.getScriptCache = function () { return {
  get: function (k) { return __memberCache[k] || null; },
  getAll: function (keys) { var found = {}; keys.forEach(function (k) { if (__memberCache[k]) found[k] = __memberCache[k]; }); return found; },
  put: function (k, v) { __memberCache[k] = v; },
  remove: function (k) { delete __memberCache[k]; },
  putAll: function (o) { Object.assign(__memberCache, o); },
  removeAll: function (keys) { keys.forEach(function (k) { delete __memberCache[k]; }); }
}; };
var __headers = ["Full Name", "Member ID", "Email", "Paid Status", "Mail Status"];
var __sheetRows = [__headers, ["TEST Ann", "CSS001", "ann@example.com", "PAID", "Pending"],
  ["TEST Bo", "CSS002", "bo@example.com", "Awaiting Cash", "Pending"],
  ["TEST Blank", "CSS003", "blank@example.com", "", ""],
  ["TEST No ID", "", "noid@example.com", "Awaiting E-transfer", ""]];
function fakeSheet() { return { getDataRange: function () { return { getValues: function () { return __sheetRows; } }; },
  getRange: function (row, col) { return { setValue: function (v) { __sheetRows[row - 1][col - 1] = v; } }; } }; }
SpreadsheetApp.openById = function () { return { getSheetByName: fakeSheet }; };
function openMemberSheet_() { return { members: rowsToMembers_(__sheetRows), columns: mapMemberColumns_(__headers), sheet: fakeSheet() }; }
function withIntakeLock_(f) { return f(); }
function withLock_(f) { return f(); }
function sendMemberWelcomeEmail_() {
  if (__moveOnSend) { var moved = __sheetRows[1]; __sheetRows[1] = __sheetRows[2]; __sheetRows[2] = moved; }
  return __mailWorks;
}
var S = { name: "TEST Exec Ann", role: "exec" };
`);
// Use the real cached member reader and real setMemberCells_/forgetMembers_ against fake Sheets.
const storeSource = fs.readFileSync(path.join(__dirname, "../api/Store.js"), "utf8");
run(storeSource.slice(storeSource.indexOf("function loadMembers_("), storeSource.indexOf("// ---- Writing")));
run("loadMembers_(); __moveOnSend = true;");
let reply = run('resendMemberPass_(S, "css001")');
ok(reply.ok && reply.member.cardSent && reply.member.mailStatus === "Sent", "successful resend returns the Sent badge for the member page");
ok(run('__sheetRows[2][4] === "Sent" && __sheetRows[1][4] === "Pending"'), "resend finds the member by ID again if the sheet was sorted while sending");
ok(run('listAllMembers_().members.find(function (m) { return m.memberId === "CSS001"; }).cardSent'), "All members reads Sent immediately, even after the old list was cached");
ok(run('findMemberById_(loadMembers_(), "CSS001").mailStatus') === "Sent", "a freshly opened member page reads the saved Sent status");
run('__moveOnSend = false; __mailWorks = false;');
ok(attempt('resendMemberPass_(S, "CSS002")').error === "EMAIL_FAILED", "a failed resend reports the failure");
ok(run('__sheetRows[1][4]') === "Pending", "a failed resend leaves Mail Status alone");
run('__mailWorks = true;');
reply = run('markMemberPaid_(S, "CSS002")');
ok(reply.emailed && run('__sheetRows[1][4]') === "Sent", "Mark paid also saves Sent after a successful card send");
run('__sheetRows[3][3] = "Awaiting E-transfer"; forgetMembers_();');
reply = run('updateMember_(S, { memberId:"CSS003", name:"TEST Blank", email:"blank@example.com", ucid:"", paid:true })');
ok(reply.emailed && run('__sheetRows[3][4]') === "Sent", "editing a member to Paid saves Sent after a successful card send");

run(`
var __notesToken = startSession_("TEST Exec Ann", "exec");
var __otherToken = startSession_("TEST Exec Bo", "exec");
var __doorToken = startSession_("TEST Door", "door");
TBL.MemberNotes = [];
`);
reply = run('route_({action:"addMemberNote", token:__notesToken, memberId:"css001", text:"  Called about their card.  ", createdBy:"Someone else"})');
ok(reply.ok && reply.note.text === "Called about their card." && reply.note.createdBy === "TEST Exec Ann" && !isNaN(Date.parse(reply.note.createdAt)), "a note saves its text, time, and signed-in exec name (ignores a supplied author)");
ok(run('route_({action:"listMemberNotes", token:__otherToken, memberId:"CSS001"}).notes.length') === 1, "another exec can read the saved note");
ok(run('route_({action:"listMemberNotes", token:__otherToken, memberId:"CSS002"}).notes.length') === 0, "notes stay with their member");
run('TBL.MemberNotes.push({ id:"old", memberId:"CSS001", year:"2000/2001", text:"Other year" });');
ok(run('listMemberNotes_("CSS001").notes.length') === 1, "a reused member ID from a different membership year does not pick up someone else's notes");
for (const text of ["", "   ", "x".repeat(501)]) {
  ok(attempt(`route_({action:"addMemberNote", token:__notesToken, memberId:"CSS001", text:${JSON.stringify(text)}})`).error === "BAD_REQUEST", "blank or too-long notes are refused");
}
ok(attempt('route_({action:"addMemberNote", token:__notesToken, memberId:"GONE", text:"Hello"})').error === "NOT_FOUND", "a missing member cannot receive a note");
for (const action of ["listMemberNotes", "addMemberNote"]) {
  ok(attempt(`route_({action:"${action}", memberId:"CSS001", text:"Hello"})`).error === "NOT_LOGGED_IN", action + " requires sign-in");
  ok(attempt(`route_({action:"${action}", token:__doorToken, memberId:"CSS001", text:"Hello"})`).error === "DOOR_ONLY", action + " is unavailable to door-only volunteers");
}
ok(!("notes" in run('route_({action:"getMember", token:__otherToken, memberId:"CSS001"}).member')), "notes are kept out of the shared member model and public member replies");
run('__sheetRows[1][3] = "Awaiting Cash"; __sheetRows[3][3] = ""; forgetMembers_();');
ok(run('listPendingMembers_(0,20).total') === 1 && run('listAllMembers_().members.filter(function(m) {return !m.paid;}).length') === 3,
  "Awaiting payment keeps its existing contents; Not paid still includes blank statuses and missing IDs");

// ---- Review fixes: notes keep their shape, can be removed by their writer or the admin
run('TBL.MemberNotes = [];');
reply = run('route_({action:"addMemberNote", token:__notesToken, memberId:"CSS001", text:"- called, will pay Fri\\nsecond line"})');
let listed = run('route_({action:"listMemberNotes", token:__otherToken, memberId:"CSS001"}).notes');
ok(listed.length === 1 && listed[0].text === "- called, will pay Fri\nsecond line", "a note keeps its leading dash and its line break: " + JSON.stringify(listed[0] && listed[0].text));
ok(run('TBL.MemberNotes[0].text').indexOf("'-") === 0, "…and is stored so the sheet can't read it as a formula");
const noteId = listed[0].id;
ok(attempt(`route_({action:"removeMemberNote", token:__otherToken, noteId:${JSON.stringify(noteId)}})`).error === "ADMIN_ONLY", "another exec can't remove someone else's note");
ok(run(`route_({action:"removeMemberNote", token:__notesToken, noteId:${JSON.stringify(noteId)}})`).ok &&
  run('route_({action:"listMemberNotes", token:__otherToken, memberId:"CSS001"}).notes.length') === 0, "the writer can remove their own note; it disappears for everyone");
ok(run('TBL.MemberNotes.length') === 1 && run('TBL.MemberNotes[0].removedBy') === "TEST Exec Ann", "…and it's kept in the sheet, marked removed (not deleted)");
run('route_({action:"addMemberNote", token:__otherToken, memberId:"CSS001", text:"Bo wrote this"}); var __adminToken = startSession_("TEST Admin", "admin");');
const boNote = run('TBL.MemberNotes[1].id');
ok(run(`route_({action:"removeMemberNote", token:__adminToken, noteId:${JSON.stringify(boNote)}})`).ok, "the admin can remove anyone's note");
ok(attempt(`route_({action:"removeMemberNote", token:__adminToken, noteId:${JSON.stringify(boNote)}})`).error === "NOT_FOUND", "removing it again says it's no longer there");

// ---- Resend card: once the email has gone, a busy sheet can't turn it into a failure
run('withIntakeLock_ = function () { throw new ApiError_("BUSY", "TEST busy"); }; __mailWorks = true;');
reply = attempt('resendMemberPass_(S, "CSS001")');
ok(reply.value && reply.value.ok && reply.value.emailed && reply.value.markedSent === false, "card sent but the sheet was busy: still reported as sent (no second card)");
run('withIntakeLock_ = function (f) { return f(); };');

// ---- Activity: sent emails only under Emails, failed ones everywhere, readable wording
run(`TBL.Log = [
  { time:"2026-11-19T10:00:00Z", who:"email", action:"email.sent", target:"a@example.com", details:JSON.stringify({ subject:"Your ticket" }) },
  { time:"2026-11-19T10:01:00Z", who:"email", action:"email.failed", target:"b@example.com", details:JSON.stringify({ subject:"Your pass" }) },
  { time:"2026-11-19T10:02:00Z", who:"TEST Exec Ann", action:"member.note", target:"CSS001", details:"{}" }];
readLastRows_ = function (name, n) { return (TBL[name] || []).slice(-n); };`);
const allAct = run('activityLog_({ group: "all" }).entries');
const emailAct = run('activityLog_({ group: "emails" }).entries');
ok(!allAct.some((e) => e.action === "email.sent") && allAct.some((e) => e.action === "email.failed"), "All hides sent emails but shows failed ones");
ok(emailAct.length === 2 && emailAct.every((e) => e.who === "Email") && /sent to a@example.com: Your ticket/.test(emailAct.find((e) => e.action === "email.sent").summary),
  "Emails shows both, readable: " + JSON.stringify(emailAct.map((e) => e.summary)));
ok(/added a note for member CSS001/.test(allAct.find((e) => e.action === "member.note").summary), "a new note reads as a sentence in Activity");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
