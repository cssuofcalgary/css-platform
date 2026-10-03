// "My tickets": a ticket belongs to the attendee, ambiguous registrations are never silently added, and cancelled tickets explain themselves.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { ok: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };

run(`
TBL.Events = [{ id:"EV1", slug:"mj", name:"Mahjong", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"MJ", archivedAt:"", summary:{} },
  { id:"EVOLD", slug:"old", name:"Old", date:"2020-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE",
  status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"OL", archivedAt:"", summary:{} }];
TBL.__members = [{ memberId:"CSS0011234", name:"Mia Member", email:"mia@gmail.com", ucid:"30111222", paid:true }];
TBL.Orders = [
  { id:"O1", code:"MJ-1", eventId:"EV1", payerName:"Dad Member", payerEmail:"dad@x.ca", total:24, status:"paid", createdAt:"2026-10-01T00:00:00Z", notes:"" },
  { id:"O2", code:"MJ-2", eventId:"EV1", payerName:"Someone", payerEmail:"s@x.ca", total:8, status:"awaiting", createdAt:"2026-10-01T00:00:00Z", notes:"" },
  { id:"OF", code:"MJ-3", eventId:"EV1", payerName:"Gone", payerEmail:"g@x.ca", total:8, status:"cancelled", createdAt:"2026-10-01T00:00:00Z", notes:"registration failed: timed out" }
];
var n = 0;
function tk(id, orderId, eventId, name, email, status, extra) { TBL.Tickets.push(Object.assign({ id:id, secret:(id+"0000000000000000000000000000").slice(0,32).toLowerCase(), orderId:orderId, eventId:eventId, name:name, email:email, ucid:"", memberId:"", ticketType:"General", price:8, answers:{}, flag:"", status:status, checkedInAt:"", createdAt:"2026-10-01T00:00:00Z" }, extra || {})); }
TBL.Tickets = [];
// Dad paid for three: his own, Mia's (Mia's email on it), and a friend's who typed Mia's UCID by mistake
tk("TKTDAD01", "O1", "EV1", "Dad Member", "dad@x.ca", "paid");
tk("TKTMIA01", "O1", "EV1", "Mia Member", "mia@gmail.com", "paid");
tk("TKTFRND1", "O1", "EV1", "Frank Friend", "frank@x.ca", "paid", { ucid:"30111222" });   // wrong UCID typed: Mia's number, Frank's name
// a ticket with Mia's verified member ID and her name but no email
tk("TKTMIA02", "O2", "EV1", "Mia M.", "", "awaiting", { memberId:"CSS0011234" });
// cancelled and refunded tickets of Mia's, a failed registration, and an old event
tk("TKTMIA03", "O2", "EV1", "Mia Member", "mia@gmail.com", "refunded");
tk("TKTFAIL1", "OF", "EV1", "Mia Member", "mia@gmail.com", "cancelled");
tk("TKTOLD01", "O1", "EVOLD", "Mia Member", "mia@gmail.com", "paid");
`);
const KEY = run('linkKey_("pass", "CSS0011234")');
const mine = run(`myTickets_({ memberId: "CSS0011234", k: "${KEY}" })`);
const ids = mine.tickets.map((t) => t.id).sort();
ok(ids.indexOf("TKTMIA01") !== -1, "a ticket someone else paid for shows up for the attendee (her email is on it)");
ok(ids.indexOf("TKTMIA02") !== -1, "a ticket with her member ID and her name shows up even with no email");
ok(ids.indexOf("TKTDAD01") === -1, "the person who paid does not get the attendee's ticket in her account, and her account has none of his");
ok(ids.indexOf("TKTFRND1") === -1 && mine.possible === 1, "a friend's ticket that only carries her UCID (different name) is NOT added, and is counted as 'possible'");
const cancelled = mine.tickets.find((t) => t.id === "TKTMIA03");
ok(cancelled && cancelled.status === "cancelled", "a refunded ticket is shown as cancelled, so 'where did my ticket go?' has an answer");
ok(ids.indexOf("TKTFAIL1") === -1, "a registration that never completed is not shown");
ok(ids.indexOf("TKTOLD01") === -1, "tickets for events already past are not shown");
ok(mine.emailHint === "m*****@gmail.com", "the screen can show which email to use: " + mine.emailHint);
ok(mine.tickets.every((t) => t.event && t.event.name), "each ticket carries its event");

// A wrong key shows nothing
ok(fn('myTickets_({ memberId: "CSS0011234", k: "wrong" })').error === "NOT_ALLOWED", "a wrong key is refused");

// Guest by email: only tickets with that email
const guest = run(`myTickets_({ email: "dad@x.ca", k: "${run('linkKey_("tix", "dad@x.ca")')}" })`);
ok(guest.tickets.length === 1 && guest.tickets[0].id === "TKTDAD01", "a guest link shows only the tickets with that email");

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
