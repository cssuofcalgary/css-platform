// Feedback walkthrough: a guest rates an event from their ticket page, and execs see the results.
// Every step prints what is being tried, then PASS or FAIL. Nothing real is touched and no email is sent.
const { sent, run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log("  " + (cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const step = (msg) => console.log("\n" + msg);
const J = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || e.message, msg: e.message }; } };
const S = { name: "Exec" };
const key = (ch) => ch.repeat(30);   // ticket page links carry a long secret; these are fake ones
const rate = (ch, rating, comment) => J(`submitFeedback_(${JSON.stringify({ secret: key(ch), rating: rating, comment: comment })})`);
const page = (ch) => J(`getTicket_("${key(ch)}")`).v;

run(`
function table_() {}
TBL.Events = [
  { id:"EV1", slug:"mj", name:"TEST Mahjong Night", description:"", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"50",
    capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"FALSE", ticketTypes:[{id:"T2",name:"General",price:9,needsMembership:false}],
    questions:[], codePrefix:"MJ", registrationCloses:"", archivedAt:"", archiveYear:"", summary:{}, createdAt:"", updatedAt:"" },
  { id:"EV2", slug:"kt", name:"TEST Karaoke", description:"", date:"2099-02-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"50",
    capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"FALSE", ticketTypes:[{id:"T2",name:"General",price:5,needsMembership:false}],
    questions:[], codePrefix:"KT", registrationCloses:"", archivedAt:"", archiveYear:"", summary:{}, createdAt:"", updatedAt:"" }];
TBL.Orders = []; TBL.Tickets = []; TBL.Waitlist = []; TBL.Feedback = []; TBL.Emails = [];
TBL.__members = [{ memberId:"CSS0011234", name:"Mia Member", email:"mia@example.com", ucid:"12345678", paid:true, row:2 }];

function addGuest(id, ch, eventId, name, email, status, checkedInAt) {
  insertRow_("Orders", { id:"O"+id, code:"MJ-"+id, eventId:eventId, payerName:name, payerEmail:email, total:9, status:status, createdAt:"2026-10-01T00:00:00Z", notes:"" });
  insertRow_("Tickets", { id:"TK"+id, secret:ch.repeat(30), orderId:"O"+id, eventId:eventId, name:name, email:email, ucid:"", memberId:"",
    ticketType:"General", price:9, answers:{}, flag:"", status:status, checkedInAt:checkedInAt, createdAt:"2026-10-01T00:00:00Z" });
}
addGuest("1", "a", "EV1", "Una Unpaid",   "una@example.com", "awaiting", "");
addGuest("2", "b", "EV1", "Ben Paid",     "ben@example.com", "paid",     "");
addGuest("3", "c", "EV1", "Mia Member",   "mia@example.com", "paid",     "2099-01-01T19:00:00Z");
addGuest("4", "d", "EV1", "Dan Refunded", "dan@example.com", "refunded", "2099-01-01T19:00:00Z");
addGuest("5", "e", "EV1", "Eve Guest",    "eve@example.com", "paid",     "2099-01-01T19:10:00Z");
addGuest("6", "f", "EV1", "Fay Guest",    "fay@example.com", "paid",     "2099-01-01T19:20:00Z");
addGuest("7", "g", "EV2", "Gus Karaoke",  "gus@example.com", "paid",     "2099-02-01T19:00:00Z");
`);

console.log("FEEDBACK WALKTHROUGH (fake event \"TEST Mahjong Night\")");

step("1. Una signed up but hasn't paid yet.");
let t = page("a");
ok(t && t.canGiveFeedback === false, "her ticket page does not show the stars");
let r = rate("a", 5);
ok(r.err === "BAD_REQUEST", "if she tries anyway, she's told: \"" + r.msg + "\"");

step("2. Ben paid but hasn't been scanned in at the door yet.");
ok(page("b").canGiveFeedback === false, "his ticket page does not show the stars");
r = rate("b", 5);
ok(r.err === "BAD_REQUEST", "if he tries anyway, he's told: \"" + r.msg + "\"");

step("3. Ben gets scanned in at the door.");
run(`updateRow_("Tickets", "TK2", { checkedInAt: "2099-01-01T18:30:00Z" })`);
t = page("b");
ok(t.canGiveFeedback === true && t.feedback === null, "now his ticket page shows empty stars, ready to rate");

step("4. Ben gives 5 stars and a comment.");
r = rate("b", 5, "So much fun, great snacks");
ok(r.v && r.v.ok && r.v.feedback.rating === 5, "it saves");
t = page("b");
ok(t.feedback && t.feedback.rating === 5 && t.feedback.comment === "So much fun, great snacks", "when he opens his ticket page again he sees his 5 stars and comment");

step("5. Ben changes his mind and gives 3 stars.");
rate("b", 3, "Fun but too crowded");
ok(run(`TBL.Feedback.filter(function (f) { return f.id === "TK2"; }).length`) === 1, "his old rating is replaced, not doubled up (one rating per ticket)");
ok(page("b").feedback.rating === 3, "his ticket page now shows 3 stars");

step("6. Silly star values are refused.");
for (const bad of [0, 6, -1, "abc", undefined]) {
  r = rate("b", bad);
  ok(r.err === "BAD_REQUEST", JSON.stringify(bad === undefined ? "nothing" : bad) + " stars: refused (\"" + r.msg + "\")");
}
ok(page("b").feedback.rating === 3, "Ben's real rating is still 3 after all that");

step("7. Someone uses a made-up ticket link.");
r = J(`submitFeedback_({ secret: "short", rating: 5 })`);
ok(r.err === "NOT_FOUND", "a short fake link: \"" + r.msg + "\"");
r = rate("z", 5);
ok(r.err === "NOT_FOUND", "a long fake link: \"" + r.msg + "\"");

step("8. Dan was scanned in, but his ticket was refunded afterwards.");
r = rate("d", 1);
ok(r.err === "BAD_REQUEST", "he can't rate: \"" + r.msg + "\"");

step("9. Mia is a club member. Her ticket didn't have her member ID typed in, but her email matches.");
rate("c", 4, "Loved it");
ok(run(`TBL.Feedback.filter(function (f) { return f.id === "TK3"; })[0].memberId`) === "CSS0011234", "her rating is still linked to her member ID, so it shows on her profile");

step("10. Tricky comments are cleaned up before saving.");
rate("e", 5, "=HYPERLINK(\"http://bad\") hi");
const saved = run(`TBL.Feedback.filter(function (f) { return f.id === "TK5"; })[0].comment`);
ok(!/^[=+\-@]/.test(saved), "a comment that looks like a spreadsheet formula can't run in the Google Sheet (saved as: " + saved + ")");
rate("e", 5, "x".repeat(2000));
const len = run(`TBL.Feedback.filter(function (f) { return f.id === "TK5"; })[0].comment.length`);
ok(len <= 500, "a 2000-letter comment is cut down to " + len + " letters");
rate("e", 5, "Best event this year");

step("11. Fay gives 2 stars and no comment. Gus rates a different event (Karaoke).");
rate("f", 2);
rate("g", 1, "Mic was broken");
// spread the times out so "newest first" can be checked
run(`[["TK2","2099-01-02T10:00:00Z"],["TK3","2099-01-02T11:00:00Z"],["TK5","2099-01-02T12:00:00Z"],["TK6","2099-01-02T13:00:00Z"]]
  .forEach(function (p) { updateRow_("Feedback", p[0], { createdAt: p[1] }); });`);

step("12. An exec opens the Mahjong results.");
const sum = J(`feedbackSummary_("EV1")`).v;
console.log("     What the exec sees: " + sum.count + " ratings, average " + sum.average + " stars, star counts [1,2,3,4,5] = " + JSON.stringify(sum.distribution));
sum.comments.forEach((c) => console.log("       " + c.rating + " stars, " + c.name + ": \"" + c.comment + "\""));
ok(sum.count === 4, "4 people rated (Ben, Mia, Eve, Fay)");
ok(sum.average === 3.5, "average is 3.5 stars ((3 + 4 + 5 + 2) / 4)");
ok(JSON.stringify(sum.distribution) === "[0,1,1,1,1]", "star counts are right");
ok(sum.comments.length === 3, "only people who wrote something show in the comments list (Fay left none)");
ok(sum.comments[0].name === "Eve Guest" && sum.comments[2].name === "Ben Paid", "newest comments are at the top");
ok(!sum.comments.some((c) => /Mic was broken/.test(c.comment)), "Gus's Karaoke comment doesn't leak into Mahjong");

step("13. The full event report includes the same feedback.");
const rep = J(`eventReport_(${JSON.stringify(S)}, "EV1")`);
ok(rep.v && rep.v.feedback && rep.v.feedback.count === 4 && rep.v.feedback.average === 3.5, "report shows 4 ratings, 3.5 average" + (rep.err ? " (error: " + rep.msg + ")" : ""));

step("14. An event nobody has rated yet.");
run(`TBL.Events.push(Object.assign({}, TBL.Events[0], { id: "EV3", slug: "bb", name: "TEST Board Games" }));`);
const empty = J(`feedbackSummary_("EV3")`).v;
ok(empty.count === 0 && empty.average === null && empty.comments.length === 0, "shows 0 ratings and no average (not a fake \"0 stars\")");

step("15. An exec looks up Mia's member history.");
const h = J(`memberHistory_(${JSON.stringify(S)}, "CSS0011234")`);
const mj = h.v && h.v.entries.filter((e) => e.eventId === "EV1")[0];
ok(mj && mj.rating === 4 && mj.comment === "Loved it", "her history shows she gave Mahjong 4 stars and what she wrote" + (h.err ? " (error: " + h.msg + ")" : ""));
ok(h.v && h.v.rated === 1, "it counts 1 event rated");

step("16. Emails.");
ok(sent.length === 0, "no emails were sent at any point (feedback never emails anyone)");

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
